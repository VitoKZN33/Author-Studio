import { Api, GrammyError, HttpError } from 'grammy';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent } from 'node:http';
import { SocksProxyAgent } from 'socks-proxy-agent';

export type TelegramErrorKind = 'rate_limited' | 'transient' | 'permanent' | 'unauthorized';

/**
 * Ошибка Bot API с классификацией для стратегии повторов:
 * rate_limited — повторить не раньше retryAfter; transient — повторить с задержкой;
 * permanent — повтор не поможет; unauthorized — неверный токен бота.
 */
export class TelegramApiError extends Error {
  constructor(
    public readonly kind: TelegramErrorKind,
    public readonly method: string,
    public readonly description: string,
    public readonly code?: number,
    public readonly retryAfter?: number,
    /**
     * Мог ли запрос дойти до Telegram. false — соединение не установлено (повтор безопасен);
     * true — запрос мог быть обработан, даже если ответ не получен (повтор может создать дубль).
     */
    public readonly requestMayHaveBeenProcessed: boolean = true,
  ) {
    super(`Telegram ${method}: ${kind}${code ? ` ${code}` : ''} — ${description}`);
    this.name = 'TelegramApiError';
  }

  /** Сообщение Telegram в нижнем регистре — для распознавания конкретных случаев. */
  matches(fragment: string): boolean {
    return this.description.toLowerCase().includes(fragment);
  }
}

/** Ошибки, при которых соединение не было установлено — запрос точно не обработан. */
const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

function causeCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const c = cur as { code?: unknown; error?: unknown; cause?: unknown; message?: unknown };
    if (typeof c.code === 'string') return c.code;
    // SOCKS-прокси не смог соединиться с целевым адресом.
    if (
      typeof c.message === 'string' &&
      /socks/i.test(c.message) &&
      /connect|reject|refused/i.test(c.message)
    ) {
      return 'ECONNREFUSED';
    }
    cur = c.error ?? c.cause;
  }
  return undefined;
}

export function classifyTelegramError(err: unknown, method: string): TelegramApiError {
  if (err instanceof TelegramApiError) return err;
  if (err instanceof GrammyError) {
    const code = err.error_code;
    if (code === 429) {
      return new TelegramApiError(
        'rate_limited',
        method,
        err.description,
        code,
        err.parameters.retry_after ?? 5,
        // 429: Telegram явно отказал в обработке — сообщение не отправлено.
        false,
      );
    }
    if (code === 401) {
      return new TelegramApiError('unauthorized', method, err.description, code, undefined, false);
    }
    if (code >= 500) return new TelegramApiError('transient', method, err.description, code);
    return new TelegramApiError('permanent', method, err.description, code, undefined, false);
  }
  if (err instanceof HttpError) {
    const code = causeCode(err);
    const notSent = code !== undefined && NOT_SENT_CODES.has(code);
    return new TelegramApiError(
      'transient',
      method,
      notSent ? 'сеть недоступна' : 'сеть недоступна или тайм-аут',
      undefined,
      undefined,
      !notSent,
    );
  }
  return new TelegramApiError(
    'transient',
    method,
    err instanceof Error ? err.message : String(err),
  );
}

/** Агент Node.js для прокси: SOCKS5 или HTTP(S) CONNECT. */
export function createProxyAgent(proxyUrl: string): Agent {
  return /^socks/i.test(proxyUrl) ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
}

export interface TelegramClientOptions {
  apiRoot?: string;
  proxyUrl?: string;
}

/** Тонкая обёртка над grammY Api: единая классификация ошибок, тайм-аут, прокси. */
export class TelegramClient {
  readonly api: Api;
  readonly botId: number;

  constructor(token: string, options: TelegramClientOptions = {}) {
    this.api = new Api(token, {
      ...(options.apiRoot ? { apiRoot: options.apiRoot } : {}),
      ...(options.proxyUrl
        ? { baseFetchConfig: { agent: createProxyAgent(options.proxyUrl), compress: true } }
        : {}),
      timeoutSeconds: 30,
    });
    this.botId = Number(token.split(':')[0]);
  }

  async call<T>(method: string, fn: (api: Api) => Promise<T>): Promise<T> {
    try {
      return await fn(this.api);
    } catch (err) {
      throw classifyTelegramError(err, method);
    }
  }
}
