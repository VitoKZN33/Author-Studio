import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq, gt, isNull, lt, notInArray, or } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { DB, type Database } from '../database/database.module.js';
import { sessions, users } from '../database/schema.js';
import type { AuthContext } from './auth.types.js';
import { InitDataError, validateInitData } from './init-data.js';

export const MAX_ACTIVE_SESSIONS = 10;
const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60_000;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: { id: string; telegramId: string; role: 'owner'; firstName: string };
  startParam?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private telegramConfig() {
    const { TELEGRAM_BOT_TOKEN: botToken, OWNER_TELEGRAM_ID: ownerId } = this.config;
    if (!botToken || !ownerId) {
      throw new ServiceUnavailableException(
        'Вход недоступен: в .env не заданы TELEGRAM_BOT_TOKEN и OWNER_TELEGRAM_ID',
      );
    }
    return { botToken, ownerId: BigInt(ownerId) };
  }

  async loginWithInitData(initData: string): Promise<LoginResult> {
    const { botToken, ownerId } = this.telegramConfig();
    let validated;
    try {
      validated = validateInitData(initData, botToken, {
        maxAgeSeconds: this.config.AUTH_INIT_DATA_MAX_AGE_SECONDS,
      });
    } catch (e) {
      if (e instanceof InitDataError) {
        throw new UnauthorizedException(
          e.reason === 'expired'
            ? 'Данные входа устарели. Закройте и снова откройте приложение в Telegram'
            : 'Не удалось подтвердить вход через Telegram',
        );
      }
      throw e;
    }

    const telegramId = BigInt(validated.user.id);
    if (telegramId !== ownerId) {
      await this.audit.record({
        action: 'auth.denied',
        metadata: { telegramId: String(telegramId) },
      });
      throw new ForbiddenException('Доступ к этой установке есть только у её владельца');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_HOURS * 3600_000);

    const user = await this.db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ telegramId, role: 'owner' })
        .onConflictDoUpdate({ target: users.telegramId, set: { updatedAt: new Date() } })
        .returning();
      await tx
        .insert(sessions)
        .values({ userId: u!.id, tokenHash: hashSessionToken(token), expiresAt });
      await this.pruneSessions(tx, u!.id);
      return u!;
    });

    await this.audit.record({ action: 'auth.login', actorUserId: user.id });
    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        telegramId: String(user.telegramId),
        role: 'owner',
        firstName: validated.user.first_name,
      },
      startParam: validated.startParam,
    };
  }

  /** Удаляет истёкшие/отозванные сессии и ограничивает число активных. */
  private async pruneSessions(tx: Pick<Database, 'select' | 'delete'>, userId: string) {
    const now = new Date();
    await tx
      .delete(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          or(lt(sessions.expiresAt, now), lt(sessions.revokedAt, now)),
        ),
      );
    const keep = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(MAX_ACTIVE_SESSIONS);
    if (keep.length === MAX_ACTIVE_SESSIONS) {
      await tx.delete(sessions).where(
        and(
          eq(sessions.userId, userId),
          notInArray(
            sessions.id,
            keep.map((k) => k.id),
          ),
        ),
      );
    }
  }

  async authenticate(token: string): Promise<AuthContext> {
    const now = new Date();
    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        lastSeenAt: sessions.lastSeenAt,
        userId: users.id,
        telegramId: users.telegramId,
        role: users.role,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashSessionToken(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .limit(1);
    if (!row) throw new UnauthorizedException('Сессия недействительна. Откройте приложение заново');

    // Если владелец установки сменился (OWNER_TELEGRAM_ID), старые сессии недействительны.
    const ownerId = this.config.OWNER_TELEGRAM_ID;
    if (!ownerId || row.telegramId !== BigInt(ownerId)) {
      throw new UnauthorizedException('Сессия недействительна. Откройте приложение заново');
    }

    if (now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_UPDATE_INTERVAL_MS) {
      await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
    }
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      telegramId: row.telegramId,
      role: row.role,
    };
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, auth.sessionId));
    await this.audit.record({ action: 'auth.logout', actorUserId: auth.userId });
  }
}
