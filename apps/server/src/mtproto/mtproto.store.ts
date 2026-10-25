import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { SecretBox } from '../crypto/secret-box.js';
import { DB, type Database } from '../database/database.module.js';
import { mtprotoAccount } from '../database/schema.js';
import type { MtprotoCredentials, MtprotoUser } from './gateway.js';

export type AccountRow = typeof mtprotoAccount.$inferSelect;

const AAD_HASH = 'mtproto.api_hash';
const AAD_SESSION = 'mtproto.session';

/** Сообщения для владельца по кодам ошибок шлюза. */
export const MTPROTO_MESSAGES: Record<string, string> = {
  api_id_invalid: 'Telegram не принял api_id / api_hash. Проверьте их на my.telegram.org.',
  phone_invalid:
    'Номер не найден в Telegram. Укажите номер в международном формате, например +79001234567.',
  phone_banned: 'Telegram сообщает, что этот номер заблокирован.',
  code_invalid: 'Неверный код. Проверьте сообщение от Telegram и введите код ещё раз.',
  code_expired: 'Код устарел. Начните вход заново — Telegram пришлёт новый.',
  password_invalid: 'Неверный пароль двухэтапной проверки.',
  flood_wait: 'Telegram временно ограничил запросы с этого аккаунта. Повторите позже.',
  session_revoked:
    'Сеанс завершён в Telegram (например, в «Устройствах»). Подключите аккаунт заново.',
  channel_unavailable:
    'Аккаунт не видит канал: проверьте, что он администратор или участник канала.',
  login_expired: 'Вход занял слишком много времени. Начните заново.',
  network:
    'Нет связи с серверами Telegram. Если сервер в РФ — проверьте TELEGRAM_PROXY_URL (нужен SOCKS5).',
  unknown: 'Telegram вернул неожиданную ошибку.',
};

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  return d.length >= 4 ? `+${d.slice(0, 1)} ••• ••• ${d.slice(-4, -2)} ${d.slice(-2)}` : null;
}

/** Строка аккаунта (одна на установку) и шифрование её секретов. */
@Injectable()
export class MtprotoStore {
  private readonly box: SecretBox;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {
    this.box = new SecretBox(config.APP_ENCRYPTION_KEY);
  }

  async row(): Promise<AccountRow> {
    const [r] = await this.db
      .select()
      .from(mtprotoAccount)
      .where(eq(mtprotoAccount.id, 1))
      .limit(1);
    if (r) return r;
    const [created] = await this.db
      .insert(mtprotoAccount)
      .values({ id: 1 })
      .onConflictDoNothing()
      .returning();
    return created ?? this.row();
  }

  async update(set: Partial<AccountRow>): Promise<void> {
    await this.row();
    await this.db
      .update(mtprotoAccount)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(mtprotoAccount.id, 1));
  }

  /** Учётные данные и сессия для сбора; null — аккаунт не подключён или ключ сменился. */
  async secrets(): Promise<{ creds: MtprotoCredentials; session: string; row: AccountRow } | null> {
    const r = await this.row();
    if (!r.apiId || !r.apiHashEncrypted || !r.sessionEncrypted) return null;
    try {
      return {
        creds: { apiId: r.apiId, apiHash: this.box.decrypt(r.apiHashEncrypted, AAD_HASH) },
        session: this.box.decrypt(r.sessionEncrypted, AAD_SESSION),
        row: r,
      };
    } catch {
      return null;
    }
  }

  async saveConnected(
    creds: MtprotoCredentials,
    session: string,
    user: MtprotoUser,
  ): Promise<void> {
    await this.update({
      apiId: creds.apiId,
      apiHashEncrypted: this.box.encrypt(creds.apiHash, AAD_HASH),
      sessionEncrypted: this.box.encrypt(session, AAD_SESSION),
      tgUserId: user.id,
      displayName: user.displayName,
      phoneMask: maskPhone(user.phone),
      status: 'active',
      lastError: null,
      floodUntil: null,
    });
  }

  async clear(status: AccountRow['status'] = 'disconnected', lastError: string | null = null) {
    await this.update({
      apiHashEncrypted: null,
      sessionEncrypted: null,
      tgUserId: null,
      displayName: null,
      phoneMask: null,
      status,
      lastError,
      floodUntil: null,
    });
  }
}
