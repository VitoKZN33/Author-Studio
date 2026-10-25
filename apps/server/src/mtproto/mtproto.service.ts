import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { VIEWS_QUEUE } from '../queue/queue.module.js';
import { MTPROTO_GATEWAY, MtprotoError, type MtprotoGateway, type MtprotoUser } from './gateway.js';
import { MTPROTO_MESSAGES, MtprotoStore } from './mtproto.store.js';

export const SYNC_ALL_JOB = 'views-sync';

interface PendingCreds {
  apiId: number;
  apiHash: string;
  expires: number;
}

/**
 * Подключение аккаунта владельца: вход по коду (и паролю 2FA), проверка, что это
 * именно аккаунт владельца установки, отключение. Вход живёт в процессе api.
 */
@Injectable()
export class MtprotoService {
  private readonly logger = new Logger(MtprotoService.name);
  /** loginId → api_id/api_hash до завершения входа (в БД попадают только после успеха). */
  private readonly creds = new Map<string, PendingCreds>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MTPROTO_GATEWAY) private readonly gateway: MtprotoGateway,
    @Inject(VIEWS_QUEUE) private readonly queue: Queue,
    private readonly store: MtprotoStore,
    private readonly audit: AuditService,
  ) {}

  private fail(e: unknown): never {
    const err = e instanceof MtprotoError ? e : new MtprotoError('unknown', String(e));
    this.logger.warn({ code: err.code, detail: err.detail }, 'MTProto: ошибка входа');
    const message =
      err.code === 'flood_wait' && err.seconds
        ? `${MTPROTO_MESSAGES.flood_wait} Подождите ${Math.ceil(err.seconds / 60)} мин.`
        : (MTPROTO_MESSAGES[err.code] ?? MTPROTO_MESSAGES.unknown!);
    const status = err.code === 'network' ? 502 : err.code === 'flood_wait' ? 429 : 400;
    throw new HttpException({ message, details: { code: err.code } }, status);
  }

  async view() {
    const r = await this.store.row();
    return {
      status: r.status,
      connected: !!r.sessionEncrypted,
      displayName: r.displayName,
      phoneMask: r.phoneMask,
      lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
      lastSyncCount: r.lastSyncCount,
      floodUntil: r.floodUntil?.toISOString() ?? null,
      lastError: r.lastError,
      intervalMinutes: this.config.VIEWS_SYNC_INTERVAL_MINUTES,
      proxy: this.config.TELEGRAM_PROXY_URL
        ? /^socks5h?:/i.test(this.config.TELEGRAM_PROXY_URL)
          ? 'socks'
          : 'unsupported'
        : 'none',
    };
  }

  async startLogin(ownerId: string, input: { apiId: number; apiHash: string; phone: string }) {
    const phone = input.phone.replace(/[^\d+]/g, '');
    if (!/^\+?\d{10,15}$/.test(phone))
      throw new BadRequestException(MTPROTO_MESSAGES.phone_invalid);
    try {
      const { loginId } = await this.gateway.startLogin(
        { apiId: input.apiId, apiHash: input.apiHash },
        phone.startsWith('+') ? phone : `+${phone}`,
      );
      this.creds.set(loginId, {
        apiId: input.apiId,
        apiHash: input.apiHash,
        expires: Date.now() + 10 * 60_000,
      });
      await this.audit.record({ action: 'mtproto.login_started', actorUserId: ownerId });
      return { loginId };
    } catch (e) {
      this.fail(e);
    }
  }

  private pending(loginId: string): PendingCreds {
    const c = this.creds.get(loginId);
    if (!c || c.expires < Date.now()) {
      this.creds.delete(loginId);
      this.fail(new MtprotoError('login_expired'));
    }
    return c;
  }

  async submitCode(ownerId: string, loginId: string, code: string) {
    const c = this.pending(loginId);
    try {
      const r = await this.gateway.submitCode(loginId, code.replace(/\D/g, ''));
      if (r.kind === 'password') return { next: 'password' as const, hint: r.hint };
      return await this.complete(ownerId, loginId, c, r.session, r.user);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.fail(e);
    }
  }

  async submitPassword(ownerId: string, loginId: string, password: string) {
    const c = this.pending(loginId);
    try {
      const r = await this.gateway.submitPassword(loginId, password);
      return await this.complete(ownerId, loginId, c, r.session, r.user);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.fail(e);
    }
  }

  private async complete(
    ownerId: string,
    loginId: string,
    c: PendingCreds,
    session: string,
    user: MtprotoUser,
  ) {
    this.creds.delete(loginId);
    const creds = { apiId: c.apiId, apiHash: c.apiHash };
    // Только аккаунт владельца установки: чужой аккаунт сразу выходит и не сохраняется.
    if (String(user.id) !== this.config.OWNER_TELEGRAM_ID) {
      await this.gateway.logout(creds, session);
      await this.audit.record({ action: 'mtproto.foreign_account', actorUserId: ownerId });
      throw new ForbiddenException(
        'Можно подключить только тот аккаунт Telegram, которым вы входите в приложение (OWNER_TELEGRAM_ID).',
      );
    }
    await this.store.saveConnected(creds, session, user);
    await this.audit.record({ action: 'mtproto.connected', actorUserId: ownerId });
    await this.syncNow().catch(() => undefined);
    return { next: 'done' as const, ...(await this.view()) };
  }

  async cancel(loginId: string) {
    this.creds.delete(loginId);
    await this.gateway.cancelLogin(loginId);
  }

  async syncNow() {
    await this.queue.add(
      SYNC_ALL_JOB,
      { force: true },
      { jobId: `views-now-${Math.floor(Date.now() / 60_000)}` },
    );
  }

  async disconnect(ownerId: string) {
    const s = await this.store.secrets();
    if (s) await this.gateway.logout(s.creds, s.session);
    await this.store.clear();
    await this.audit.record({ action: 'mtproto.disconnected', actorUserId: ownerId });
    return this.view();
  }
}
