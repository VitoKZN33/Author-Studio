import { Api, GrammyError, HttpError } from 'grammy';

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
  ) {
    super(`Telegram ${method}: ${kind}${code ? ` ${code}` : ''} — ${description}`);
    this.name = 'TelegramApiError';
  }

  /** Сообщение Telegram в нижнем регистре — для распознавания конкретных случаев. */
  matches(fragment: string): boolean {
    return this.description.toLowerCase().includes(fragment);
  }
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
      );
    }
    if (code === 401) {
      return new TelegramApiError('unauthorized', method, err.description, code);
    }
    if (code >= 500) return new TelegramApiError('transient', method, err.description, code);
    return new TelegramApiError('permanent', method, err.description, code);
  }
  if (err instanceof HttpError) {
    return new TelegramApiError('transient', method, 'сеть недоступна или тайм-аут');
  }
  return new TelegramApiError(
    'transient',
    method,
    err instanceof Error ? err.message : String(err),
  );
}

/** Тонкая обёртка над grammY Api: единая классификация ошибок и тайм-аут. */
export class TelegramClient {
  readonly api: Api;
  readonly botId: number;

  constructor(token: string, apiRoot?: string) {
    this.api = new Api(token, {
      ...(apiRoot ? { apiRoot } : {}),
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
