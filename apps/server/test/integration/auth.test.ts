import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initDataFor } from '../../src/auth/init-data.test-helpers.js';
import { applyAppEnv, telegramEnv } from './env.js';
import { BOT_TOKEN, FakeTelegram, OWNER_ID, WEBHOOK_SECRET } from './fake-telegram.js';

const fake = new FakeTelegram();
await fake.start();
applyAppEnv({ ...telegramEnv(fake.url), AUTH_LOGIN_RATE_LIMIT: '30' });
const { createApiApp } = await import('../../src/create-api-app.js');
const { PG_POOL } = await import('../../src/database/database.module.js');
const { TELEGRAM_UPDATES_QUEUE } = await import('../../src/queue/queue.module.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let app: NestExpressApplication;
let base: string;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function login(userId = OWNER_ID): Promise<string> {
  const res = await post('/api/auth/telegram', { initData: initDataFor(userId, BOT_TOKEN) });
  expect(res.status).toBe(200);
  return ((await res.json()) as Json).token as string;
}

beforeAll(async () => {
  app = await createApiApp();
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  await app.get(PG_POOL).query('delete from sessions; delete from channels; delete from users;');
});

afterAll(async () => {
  await app.close();
  await fake.stop();
});

describe('вход через Telegram Mini App', () => {
  it('владелец получает токен сессии; в БД хранится только хэш', async () => {
    const res = await post('/api/auth/telegram', {
      initData: initDataFor(OWNER_ID, BOT_TOKEN, { extra: { start_param: 'channels' } }),
    });
    const body = (await res.json()) as Json;
    expect(res.status).toBe(200);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.user.telegramId).toBe(String(OWNER_ID));
    expect(body.startParam).toBe('channels');
    const { rows } = await app.get(PG_POOL).query('select token_hash from sessions');
    expect(rows.some((r: { token_hash: string }) => r.token_hash === body.token)).toBe(false);
  });

  it('подделанные initData → 401', async () => {
    const forged = initDataFor(OWNER_ID, BOT_TOKEN).replace('hash=', 'hash=0');
    expect((await post('/api/auth/telegram', { initData: forged })).status).toBe(401);
    const otherBot = initDataFor(OWNER_ID, '1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect((await post('/api/auth/telegram', { initData: otherBot })).status).toBe(401);
  });

  it('устаревшие initData → 401 с подсказкой', async () => {
    const old = initDataFor(OWNER_ID, BOT_TOKEN, { authDate: new Date(Date.now() - 2 * 3600_000) });
    const res = await post('/api/auth/telegram', { initData: old });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Json).error.message).toContain('устарели');
  });

  it('чужой пользователь Telegram → 403 и запись в журнале', async () => {
    const res = await post('/api/auth/telegram', { initData: initDataFor(999, BOT_TOKEN) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as Json).error.message).toContain('только у её владельца');
    const { rows } = await app
      .get(PG_POOL)
      .query("select metadata from audit_log where action = 'auth.denied'");
    expect(rows.at(-1).metadata).toEqual({ telegramId: '999' });
  });

  it('пустое тело → 400 с перечнем полей', async () => {
    const res = await post('/api/auth/telegram', {});
    const body = (await res.json()) as Json;
    expect(res.status).toBe(400);
    expect(body.error.details[0].field).toBe('initData');
  });
});

describe('защищённые маршруты', () => {
  it('без токена, с мусорным и с чужим форматом → 401', async () => {
    expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);
    const garbage = await fetch(`${base}/api/auth/me`, {
      headers: { authorization: 'Bearer ' + 'x'.repeat(43) },
    });
    expect(garbage.status).toBe(401);
    const basic = await fetch(`${base}/api/channels`, { headers: { authorization: 'Basic abc' } });
    expect(basic.status).toBe(401);
  });

  it('с токеном → 200; после выхода → 401', async () => {
    const token = await login();
    const auth = { authorization: `Bearer ${token}` };
    const me = await fetch(`${base}/api/auth/me`, { headers: auth });
    expect(me.status).toBe(200);
    expect(((await me.json()) as Json).user.role).toBe('owner');
    expect((await post('/api/auth/logout', {}, auth)).status).toBe(204);
    expect((await fetch(`${base}/api/auth/me`, { headers: auth })).status).toBe(401);
  });

  it('истёкшая сессия → 401', async () => {
    const token = await login();
    await app.get(PG_POOL).query("update sessions set expires_at = now() - interval '1 minute'");
    expect(
      (await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(401);
  });

  it('число активных сессий ограничено', async () => {
    for (let i = 0; i < 3; i++) await login();
    const { rows } = await app.get(PG_POOL).query('select count(*)::int as n from sessions');
    expect(rows[0].n).toBeLessThanOrEqual(10);
  });
});

describe('webhook Telegram', () => {
  const update = { update_id: 424242, message: { message_id: 1 } };

  it('без секрета или с неверным секретом → 401', async () => {
    expect((await post('/api/telegram/webhook', update)).status).toBe(401);
    const wrong = await post('/api/telegram/webhook', update, {
      'x-telegram-bot-api-secret-token': 'wrong-secret-wrong-secret-wrong-sec',
    });
    expect(wrong.status).toBe(401);
  });

  it('с верным секретом → 200; повторная доставка не создаёт второе задание', async () => {
    const headers = { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET };
    expect((await post('/api/telegram/webhook', update, headers)).status).toBe(200);
    expect((await post('/api/telegram/webhook', update, headers)).status).toBe(200);
    const queue = app.get(TELEGRAM_UPDATES_QUEUE);
    const job = await queue.getJob('update-424242');
    expect(job?.data).toEqual(update);
    expect(await queue.getWaitingCount()).toBe(1);
    await queue.obliterate({ force: true });
  });
});

describe('ограничение частоты входа', () => {
  it('сверх AUTH_LOGIN_RATE_LIMIT попыток в минуту → 429 на русском', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 32; i++) last = await post('/api/auth/telegram', { initData: 'x' });
    expect(last!.status).toBe(429);
    expect(((await last!.json()) as Json).error.message).toContain('Слишком много запросов');
  });
});
