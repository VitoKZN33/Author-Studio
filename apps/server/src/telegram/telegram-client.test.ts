import { GrammyError, HttpError } from 'grammy';
import { describe, expect, it } from 'vitest';
import { classifyTelegramError } from './telegram-client.js';

function grammyError(code: number, description: string, retry_after?: number) {
  return new GrammyError(
    'Call failed',
    { ok: false, error_code: code, description, parameters: retry_after ? { retry_after } : {} },
    'sendMessage',
    {},
  );
}

describe('classifyTelegramError', () => {
  it('429 → rate_limited с retry_after', () => {
    const e = classifyTelegramError(
      grammyError(429, 'Too Many Requests: retry after 17', 17),
      'sendMessage',
    );
    expect(e.kind).toBe('rate_limited');
    expect(e.retryAfter).toBe(17);
  });

  it('5xx → transient, 400/403 → permanent, 401 → unauthorized', () => {
    expect(classifyTelegramError(grammyError(502, 'Bad Gateway'), 'x').kind).toBe('transient');
    expect(classifyTelegramError(grammyError(400, 'Bad Request: chat not found'), 'x').kind).toBe(
      'permanent',
    );
    expect(classifyTelegramError(grammyError(403, 'Forbidden: bot was kicked'), 'x').kind).toBe(
      'permanent',
    );
    expect(classifyTelegramError(grammyError(401, 'Unauthorized'), 'x').kind).toBe('unauthorized');
  });

  it('сетевая ошибка → transient', () => {
    const e = classifyTelegramError(
      new HttpError('Network request failed', new Error('ECONNRESET')),
      'getChat',
    );
    expect(e.kind).toBe('transient');
    expect(e.method).toBe('getChat');
  });

  it('matches ищет фрагмент описания без учёта регистра', () => {
    expect(
      classifyTelegramError(grammyError(400, 'Bad Request: CHAT not found'), 'x').matches(
        'chat not found',
      ),
    ).toBe(true);
  });
});

describe('createProxyAgent', () => {
  it('socks5:// → SOCKS-агент, http:// → CONNECT-агент', async () => {
    const { createProxyAgent } = await import('./telegram-client.js');
    const { SocksProxyAgent } = await import('socks-proxy-agent');
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    expect(createProxyAgent('socks5://u:p@127.0.0.1:1080')).toBeInstanceOf(SocksProxyAgent);
    expect(createProxyAgent('socks5h://127.0.0.1:1080')).toBeInstanceOf(SocksProxyAgent);
    expect(createProxyAgent('http://127.0.0.1:3128')).toBeInstanceOf(HttpsProxyAgent);
  });
});
