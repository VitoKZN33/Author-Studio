import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка подлинности initData Telegram Mini Apps на сервере.
 * Алгоритм (core.telegram.org/bots/webapps, «Validating data received via the Mini App»):
 *   secret = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   hash   = hex(HMAC_SHA256(key = secret, data = data_check_string))
 * data_check_string — все поля, кроме hash, в виде key=value, отсортированные по ключу
 * и соединённые \n. initDataUnsafe на клиенте доказательством не является.
 */

export interface TelegramInitUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface ValidatedInitData {
  user: TelegramInitUser;
  authDate: Date;
  startParam?: string;
  chatType?: string;
}

export type InitDataFailure =
  'missing' | 'malformed' | 'bad_signature' | 'expired' | 'future' | 'no_user';

export class InitDataError extends Error {
  constructor(public readonly reason: InitDataFailure) {
    super(`initData отклонены: ${reason}`);
    this.name = 'InitDataError';
  }
}

export interface ValidateOptions {
  /** Максимальный возраст auth_date, секунд. */
  maxAgeSeconds: number;
  /** Допустимое опережение часов клиента/Telegram, секунд. */
  clockSkewSeconds?: number;
  now?: Date;
}

export const MAX_INIT_DATA_LENGTH = 8_192;

export function computeInitDataHash(dataCheckString: string, botToken: string): Buffer {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(dataCheckString).digest();
}

export function buildDataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

export function validateInitData(
  raw: string,
  botToken: string,
  options: ValidateOptions,
): ValidatedInitData {
  if (!raw) throw new InitDataError('missing');
  if (raw.length > MAX_INIT_DATA_LENGTH) throw new InitDataError('malformed');

  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  // Повторяющиеся ключи делают строку проверки неоднозначной — отклоняем.
  if (new Set(keys).size !== keys.length) throw new InitDataError('malformed');

  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new InitDataError('malformed');

  const expected = computeInitDataHash(buildDataCheckString(params), botToken);
  const received = Buffer.from(hash, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new InitDataError('bad_signature');
  }

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw || !/^\d{1,12}$/.test(authDateRaw)) throw new InitDataError('malformed');
  const authDate = new Date(Number(authDateRaw) * 1000);
  const now = options.now ?? new Date();
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > options.maxAgeSeconds) throw new InitDataError('expired');
  if (-ageSeconds > (options.clockSkewSeconds ?? 60)) throw new InitDataError('future');

  const userRaw = params.get('user');
  if (!userRaw) throw new InitDataError('no_user');
  let user: TelegramInitUser;
  try {
    user = JSON.parse(userRaw) as TelegramInitUser;
  } catch {
    throw new InitDataError('malformed');
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new InitDataError('no_user');
  }

  return {
    user,
    authDate,
    startParam: params.get('start_param') ?? undefined,
    chatType: params.get('chat_type') ?? undefined,
  };
}
