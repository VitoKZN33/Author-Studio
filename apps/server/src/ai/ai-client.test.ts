import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiError, chatCompletion, extractJson } from './ai-client.js';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let handler: Handler = () => undefined;
const seen: { body: Record<string, unknown>; auth: string | undefined }[] = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ body: JSON.parse(body || '{}'), auth: req.headers.authorization });
    handler(req, body, res);
  });
});
let base = '';

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const ok =
  (content: string, finish = 'stop') =>
  (_: unknown, __: string, res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: finish }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }),
    );
  };
const status = (code: number, body: unknown = { error: { message: `err ${code}` } }) =>
  ((_: unknown, __: string, res: ServerResponse) => {
    res.writeHead(code, { 'content-type': 'application/json', 'retry-after': '0' });
    res.end(JSON.stringify(body));
  }) as Handler;

const call = (extra: Partial<Parameters<typeof chatCompletion>[0]> = {}) =>
  chatCompletion({
    baseUrl: base,
    apiKey: 'sk-unit-test-key-123456',
    model: 'm',
    messages: [{ role: 'user', content: 'привет' }],
    maxTokens: 50,
    timeoutMs: 2000,
    backoffMs: 1,
    ...extra,
  });

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AiError);
    return (e as AiError).code;
  }
  throw new Error('ожидалась ошибка');
}

describe('chatCompletion', () => {
  it('успешный ответ: текст, токены, ключ в заголовке Authorization', async () => {
    seen.length = 0;
    handler = ok('готово');
    const r = await call();
    expect(r).toEqual({
      content: 'готово',
      promptTokens: 11,
      completionTokens: 7,
      truncated: false,
    });
    expect(seen[0]!.auth).toBe('Bearer sk-unit-test-key-123456');
    expect(seen[0]!.body).toMatchObject({ model: 'm', max_tokens: 50, stream: false });
  });

  it('finish_reason=length → truncated', async () => {
    handler = ok('оборван', 'length');
    expect((await call()).truncated).toBe(true);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [402, 'payment_required'],
    [404, 'not_found'],
    [400, 'bad_request'],
  ])('HTTP %i → %s без повторов', async (s, c) => {
    seen.length = 0;
    handler = status(s);
    expect(await code(call())).toBe(c);
    expect(seen).toHaveLength(1);
  });

  it('429 и 5xx повторяются не больше 2 раз', async () => {
    seen.length = 0;
    handler = status(429);
    expect(await code(call())).toBe('rate_limited');
    expect(seen).toHaveLength(3);
    seen.length = 0;
    handler = status(503);
    expect(await code(call())).toBe('server');
    expect(seen).toHaveLength(3);
  });

  it('500, затем успех → результат', async () => {
    seen.length = 0;
    let n = 0;
    handler = (req, body, res) =>
      n++ === 0 ? status(500)(req, body, res) : ok('ок')(req, body, res);
    expect((await call()).content).toBe('ок');
    expect(seen).toHaveLength(2);
  });

  it('тайм-аут', async () => {
    handler = () => undefined; // не отвечаем
    expect(await code(call({ timeoutMs: 200, retries: 0 }))).toBe('timeout');
  });

  it('ответ не JSON / без choices / пустой', async () => {
    handler = (_, __, res) => {
      res.writeHead(200);
      res.end('<html>');
    };
    expect(await code(call())).toBe('bad_response');
    handler = status(200, { foo: 1 });
    expect(await code(call())).toBe('bad_response');
    handler = ok('   ');
    expect(await code(call())).toBe('empty');
  });

  it('нет соединения → network', async () => {
    expect(await code(call({ baseUrl: 'http://127.0.0.1:1/v1', retries: 0 }))).toBe('network');
  });

  it('провайдер без response_format: повтор без него', async () => {
    seen.length = 0;
    handler = (req, body, res) =>
      JSON.parse(body).response_format
        ? status(400, { error: { message: 'response_format is not supported' } })(req, body, res)
        : ok('{"a":1}')(req, body, res);
    expect((await call({ json: true })).content).toBe('{"a":1}');
    expect(seen).toHaveLength(2);
  });

  it('сообщение об ошибке не содержит ключа', async () => {
    handler = status(401, { error: { message: 'bad key' } });
    try {
      await call();
    } catch (e) {
      expect(JSON.stringify({ m: (e as Error).message, d: (e as AiError).detail })).not.toContain(
        'sk-unit',
      );
    }
  });
});

describe('extractJson', () => {
  it('чистый JSON, блок ```json``` и текст вокруг', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Вот:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Ответ: {"a":3} — готово')).toEqual({ a: 3 });
  });
  it('без JSON → bad_response', () => {
    expect(() => extractJson('нет')).toThrow(AiError);
  });
});
