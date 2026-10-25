import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDataFor } from '../../src/auth/init-data.test-helpers.js';
import { applyAppEnv, telegramEnv } from './env.js';
import {
  adminMember,
  BOT_ID,
  BOT_TOKEN,
  channelChat,
  FakeTelegram,
  OWNER_ID,
} from './fake-telegram.js';

/**
 * AI-ассистент против имитации OpenAI-совместимого API. Настоящий провайдер
 * (DeepSeek и т. п.) в тестах не вызывается.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const KEY = 'sk-integration-secret-key-0123456789';
const CHAT = -1002000000077;

const fake = new FakeTelegram();
await fake.start();

// ---- имитация провайдера
type Reply = (body: Json, res: ServerResponse) => void;
let reply: Reply = () => undefined;
const calls: { body: Json; auth: string | undefined }[] = [];
const provider = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    calls.push({ body, auth: req.headers.authorization });
    reply(body, res);
  });
});
await new Promise<void>((r) => provider.listen(0, '127.0.0.1', r));
const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;

const answer =
  (content: string | ((body: Json) => string)): Reply =>
  (body, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { content: typeof content === 'string' ? content : content(body) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    );
  };
const fail =
  (status: number): Reply =>
  (_, res) => {
    res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '0' });
    res.end(JSON.stringify({ error: { message: `provider says ${status}` } }));
  };

applyAppEnv(telegramEnv(fake.url));
const { createApiApp } = await import('../../src/create-api-app.js');
const { PG_POOL } = await import('../../src/database/database.module.js');

let app: NestExpressApplication;
let base: string;
let auth: Record<string, string>;
let channelId: string;
const db = () => app.get(PG_POOL);

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, raw: text };
}

const configure = (extra: Record<string, unknown> = {}) =>
  api('PUT', '/ai/settings', {
    enabled: true,
    baseUrl: providerUrl,
    model: 'test-model',
    apiKey: KEY,
    dailyRequestLimit: 100,
    monthlyTokenLimit: null,
    ...extra,
  });

beforeAll(async () => {
  app = await createApiApp();
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  await db().query(
    'delete from ai_requests; delete from ai_settings; delete from channel_messages; delete from message_metric_snapshots; delete from channel_metric_snapshots; delete from publications; delete from posts; delete from sessions; delete from channels; delete from users;',
  );
  fake.on('getChat', (p) => channelChat(Number(p.chat_id), 'ai_channel', 'AI канал'));
  fake.on('getChatMember', (p) =>
    Number(p.user_id) === BOT_ID
      ? adminMember(BOT_ID)
      : {
          status: 'creator',
          user: { id: OWNER_ID, is_bot: false, first_name: 'O' },
          is_anonymous: false,
        },
  );
  fake.on('getChatMemberCount', () => 120);
  const res = await fetch(`${base}/api/auth/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: initDataFor(OWNER_ID, BOT_TOKEN) }),
  });
  auth = { authorization: `Bearer ${((await res.json()) as Json).token}` };
  channelId = (await api('POST', '/channels/connect', { chat: String(CHAT) })).body.id;
});

beforeEach(async () => {
  calls.length = 0;
  reply = answer('готово');
  await db().query('delete from ai_requests');
});

afterAll(async () => {
  await app.close();
  await fake.stop();
  await new Promise<void>((r) => provider.close(() => r()));
});

describe('настройки и ключ', () => {
  it('до настройки: статус not_configured, запросы → 409', async () => {
    const s = await api('GET', '/ai/settings');
    expect(s.body).toMatchObject({ status: 'not_configured', hasKey: false, enabled: false });
    expect(s.body.baseUrl).toBe('https://api.deepseek.com');
    const r = await api('POST', '/ai/text', { action: 'fix', text: 'превет' });
    expect(r.status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it('ключ сохраняется зашифрованным и не возвращается в API', async () => {
    const r = await configure();
    expect(r.status).toBe(200);
    expect(r.raw).not.toContain(KEY);
    expect(r.body).toMatchObject({ hasKey: true, keyMask: '…6789', status: 'unchecked' });
    const { rows } = await db().query('select * from ai_settings');
    expect(JSON.stringify(rows)).not.toContain(KEY);
    expect(rows[0].api_key_encrypted).toMatch(/^v1\./);
    const audit = await db().query("select metadata from audit_log where action = 'ai.settings'");
    expect(JSON.stringify(audit.rows)).not.toContain(KEY);
    expect((await api('GET', '/ai/settings')).raw).not.toContain(KEY);
  });

  it('изменение без ключа не трогает ключ; пустая строка удаляет', async () => {
    await api('PUT', '/ai/settings', { styleGuide: 'Пишем коротко, на ты' });
    expect((await api('GET', '/ai/settings')).body.hasKey).toBe(true);
    await api('PUT', '/ai/settings', { apiKey: '' });
    expect((await api('GET', '/ai/settings')).body).toMatchObject({
      hasKey: false,
      status: 'not_configured',
    });
    await configure();
  });

  it('неверные значения → 422/400 с русским сообщением', async () => {
    const r = await api('PUT', '/ai/settings', { baseUrl: 'ftp://x', timeoutSeconds: 1 });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(r.body.error.message).toMatch(/[а-я]/i);
  });
});

describe('проверка подключения', () => {
  it('успех: ключ передан в Authorization, статус ok, запрос учтён', async () => {
    const r = await api('POST', '/ai/test');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, reply: 'готово' });
    expect(calls[0]!.auth).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.body.model).toBe('test-model');
    expect((await api('GET', '/ai/settings')).body.status).toBe('ok');
    const { rows } = await db().query('select kind, ok, prompt_tokens from ai_requests');
    expect(rows).toEqual([{ kind: 'test', ok: true, prompt_tokens: 100 }]);
  });

  it.each([
    [401, 502, 'unauthorized'],
    [402, 502, 'payment_required'],
    [429, 429, 'rate_limited'],
    [500, 502, 'server'],
  ])('провайдер %i → %i, код %s, ключ не в ответе', async (s, http, code) => {
    reply = fail(s);
    const r = await api('POST', '/ai/test');
    expect(r.status).toBe(http);
    expect(r.body.error.details.code).toBe(code);
    expect(r.body.error.message).toMatch(/[а-я]/i);
    expect(r.raw).not.toContain(KEY);
    const st = (await api('GET', '/ai/settings')).body;
    expect(st.status).toBe('error');
    expect(st.lastError).toMatch(/[а-я]/i);
  });

  it('недоступный провайдер → 502 network', async () => {
    await configure({ baseUrl: 'http://127.0.0.1:1/v1' });
    const r = await api('POST', '/ai/test');
    expect(r.status).toBe(502);
    expect(r.body.error.details.code).toBe('network');
    await configure();
  });
});

describe('текст поста', () => {
  it('сокращение: текст как данные, результат с entities', async () => {
    reply = answer(JSON.stringify({ variants: ['**Коротко**: суть [тут](https://ex.ru)'] }));
    const r = await api('POST', '/ai/text', { action: 'shorten', text: 'Длинный пост про суть' });
    expect(r.status).toBe(200);
    expect(r.body.variants).toEqual([
      {
        text: 'Коротко: суть тут',
        entities: [
          { type: 'bold', offset: 0, length: 7 },
          { type: 'text_link', offset: 14, length: 3, url: 'https://ex.ru' },
        ],
        tooLong: false,
      },
    ]);
    const user = calls[0]!.body.messages.at(-1).content as string;
    expect(user).toContain('<<<ДАННЫЕ\nДлинный пост про суть\nДАННЫЕ>>>');
    expect(user).toContain('Пишем коротко, на ты');
    expect(calls[0]!.body.response_format).toEqual({ type: 'json_object' });
  });

  it('ответ не по схеме → одна повторная попытка, затем 502 bad_format', async () => {
    reply = answer('просто текст без JSON');
    const r = await api('POST', '/ai/text', { action: 'fix', text: 'текст' });
    expect(r.status).toBe(502);
    expect(r.body.error.details.code).toBe('bad_format');
    expect(calls).toHaveLength(2);
  });

  it('слишком длинный вариант помечается tooLong (лимит подписи к медиа)', async () => {
    reply = answer(JSON.stringify({ variants: ['а'.repeat(1100)] }));
    const r = await api('POST', '/ai/text', {
      action: 'rewrite',
      text: 'x',
      hasMedia: true,
      tone: 'formal',
    });
    expect(r.body.maxLength).toBe(1024);
    expect(r.body.variants[0].tooLong).toBe(true);
  });

  it('write без темы → 400 без обращения к провайдеру', async () => {
    const r = await api('POST', '/ai/text', { action: 'write', text: '' });
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('AI выключен → 409', async () => {
    await api('PUT', '/ai/settings', { enabled: false });
    expect((await api('POST', '/ai/text', { action: 'fix', text: 'x' })).status).toBe(409);
    await api('PUT', '/ai/settings', { enabled: true });
  });
});

describe('лимиты', () => {
  it('дневной лимит запросов → 429 без обращения к провайдеру', async () => {
    reply = answer(JSON.stringify({ variants: ['ok'] }));
    await api('PUT', '/ai/settings', { dailyRequestLimit: 2 });
    expect((await api('POST', '/ai/text', { action: 'fix', text: 'a' })).status).toBe(200);
    expect((await api('POST', '/ai/text', { action: 'fix', text: 'a' })).status).toBe(200);
    const n = calls.length;
    const r = await api('POST', '/ai/text', { action: 'fix', text: 'a' });
    expect(r.status).toBe(429);
    expect(r.body.error.message).toMatch(/дневной лимит/);
    expect(calls).toHaveLength(n);
    await api('PUT', '/ai/settings', { dailyRequestLimit: 100 });
  });

  it('месячный лимит токенов → 429', async () => {
    reply = answer(JSON.stringify({ variants: ['ok'] }));
    await api('PUT', '/ai/settings', { monthlyTokenLimit: 1000 });
    await db().query(
      "insert into ai_requests (kind, model, ok, prompt_tokens, completion_tokens, duration_ms) values ('text', 'm', true, 900, 200, 10)",
    );
    const r = await api('POST', '/ai/text', { action: 'fix', text: 'a' });
    expect(r.status).toBe(429);
    expect(r.body.error.message).toMatch(/месячный лимит/);
    await api('PUT', '/ai/settings', { monthlyTokenLimit: null });
  });

  it('учёт расхода и оценка стоимости по ценам владельца', async () => {
    await api('PUT', '/ai/settings', { priceInputPerMillion: 30, priceOutputPerMillion: 60 });
    await api('POST', '/ai/test');
    const u = (await api('GET', '/ai/usage')).body;
    expect(u.today.requests).toBe(0); // проверки подключения не тратят дневной лимит
    expect(u.month).toMatchObject({ requests: 1, input: 100, output: 50, tokens: 150 });
    expect(u.month.estimatedCostRub).toBe(0.01);
  });
});

describe('контент-план', () => {
  it('пункты вне периода и с неверным форматом отбрасываются; черновики создаются', async () => {
    await db().query(
      "insert into channel_messages (channel_id, message_id, posted_at, summary, source) values ($1, 1, now() - interval '1 day', 'Пост про кофе', 'channel_post')",
      [channelId],
    );
    reply = answer((body) => {
      const user = body.messages.at(-1).content as string;
      const from = /начиная с (\d{4}-\d{2}-\d{2})/.exec(body.messages.at(-1).content)![1]!;
      expect(user).toContain('Пост про кофе');
      return JSON.stringify({
        items: [
          { date: from, time: '10:00', title: 'Тема 1', idea: 'Идея 1' },
          { date: '2000-01-01', title: 'Старое', idea: 'x' },
          { date: from, title: '', idea: 'без заголовка' },
          { date: from, time: null, title: 'Тема 2', idea: 'Идея 2' },
        ],
      });
    });
    const r = await api('POST', '/ai/plan', { topic: 'Кофе', days: 7, postsPerWeek: 3, channelId });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: Json) => i.title)).toEqual(['Тема 2', 'Тема 1']);
    expect(r.body.rejected).toBe(2);

    const d = await api('POST', '/ai/plan/drafts', {
      items: r.body.items.map((i: Json) => ({ title: i.title, idea: i.idea })),
    });
    expect(d.status).toBe(201);
    expect(d.body.ids).toHaveLength(2);
    const post = (await api('GET', `/posts/${d.body.ids[0]}`)).body;
    expect(post.content.text).toBe('Тема 2\n\nИдея 2');
    expect(post.content.entities).toEqual([{ type: 'bold', offset: 0, length: 6 }]);
    expect(post.publications).toEqual([]); // ничего не запланировано
  });
});

describe('разбор аналитики', () => {
  it('факты считает приложение; числа, которых нет в данных, помечаются', async () => {
    await db().query(
      "insert into channel_metric_snapshots (channel_id, metric, value, source, measured_at) values ($1, 'subscribers', 120, 'telegram_api', now())",
      [channelId],
    );
    reply = answer(
      JSON.stringify({
        observations: ['Сейчас 120 подписчиков', 'Охват 5400'],
        hypotheses: ['Возможно, тема кофе интересна'],
        recommendations: ['Опубликовать ещё 3 поста'],
      }),
    );
    const r = await api('POST', '/ai/analytics', { channelId, days: 30 });
    expect(r.status).toBe(200);
    expect(r.body.facts).toEqual(
      expect.arrayContaining([
        { label: 'Подписчиков сейчас', value: '120', source: 'telegram' },
        { label: 'Постов за период', value: '1', source: 'system' },
      ]),
    );
    expect(r.body.sufficiency.level).toBe('low');
    expect(r.body.ai.unverifiedNumbers).toEqual(['5400']);
    expect(r.body.period).toMatchObject({ days: 30, channelTitle: 'AI канал' });
    expect(calls[0]!.body.temperature).toBe(0.2);
  });

  it('чужой/несуществующий канал → 404 без обращения к провайдеру', async () => {
    const r = await api('POST', '/ai/analytics', {
      channelId: '00000000-0000-4000-8000-000000000000',
      days: 30,
    });
    expect(r.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe('без авторизации', () => {
  it('все маршруты AI требуют сессию', async () => {
    for (const [m, p] of [
      ['GET', '/ai/settings'],
      ['PUT', '/ai/settings'],
      ['POST', '/ai/test'],
      ['POST', '/ai/text'],
    ] as const) {
      const res = await fetch(`${base}/api${p}`, {
        method: m,
        headers: { 'content-type': 'application/json' },
        body: m === 'GET' ? undefined : '{}',
      });
      expect(res.status).toBe(401);
    }
  });
});
