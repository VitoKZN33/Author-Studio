/**
 * Шлюз к Telegram API (MTProto) от имени аккаунта владельца. Интерфейс отделён от
 * реализации (GramJS), чтобы вход и сбор просмотров проверялись тестами без сети.
 */

export interface MtprotoCredentials {
  apiId: number;
  apiHash: string;
}

export interface MtprotoUser {
  id: bigint;
  displayName: string;
  phone: string | null;
}

export type CodeResult =
  { kind: 'done'; session: string; user: MtprotoUser } | { kind: 'password'; hint: string | null };

export interface ChannelRef {
  /** ID канала в формате Bot API (-100…). */
  chatId: bigint;
  username: string | null;
}

export interface MessageViews {
  id: number;
  views: number | null;
  forwards: number | null;
}

/** Коды ошибок шлюза, которые сервис показывает владельцу по-русски. */
export type MtprotoErrorCode =
  | 'api_id_invalid'
  | 'phone_invalid'
  | 'phone_banned'
  | 'code_invalid'
  | 'code_expired'
  | 'password_invalid'
  | 'flood_wait'
  | 'session_revoked'
  | 'channel_unavailable'
  | 'login_expired'
  | 'network'
  | 'unknown';

export class MtprotoError extends Error {
  constructor(
    public readonly code: MtprotoErrorCode,
    public readonly detail?: string,
    /** Для flood_wait — сколько секунд ждать. */
    public readonly seconds?: number,
  ) {
    super(code);
    this.name = 'MtprotoError';
  }
}

export interface MtprotoGateway {
  /** Отправляет код входа; вход продолжается по loginId (живёт ограниченное время). */
  startLogin(creds: MtprotoCredentials, phone: string): Promise<{ loginId: string }>;
  submitCode(loginId: string, code: string): Promise<CodeResult>;
  submitPassword(
    loginId: string,
    password: string,
  ): Promise<{ session: string; user: MtprotoUser }>;
  cancelLogin(loginId: string): Promise<void>;
  /** Просмотры и пересылки сообщений канала (не больше 100 id за вызов). */
  fetchViews(
    creds: MtprotoCredentials,
    session: string,
    channel: ChannelRef,
    messageIds: number[],
  ): Promise<MessageViews[]>;
  /** Удаляет сообщения канала от имени владельца (без ограничения 48 часов у бота). */
  deleteMessages(
    creds: MtprotoCredentials,
    session: string,
    channel: ChannelRef,
    messageIds: number[],
  ): Promise<void>;
  /** Завершает сессию на стороне Telegram (видна в «Активных сеансах»). */
  logout(creds: MtprotoCredentials, session: string): Promise<void>;
}

export const MTPROTO_GATEWAY = Symbol('MTPROTO_GATEWAY');
