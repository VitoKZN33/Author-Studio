import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDataFor } from '../../src/auth/init-data.test-helpers.js';
import { applyAppEnv, telegramEnv } from './env.js';
import {
  adminMember,
  BOT_ID,
  BOT_TOKEN,
  channelChat,
  FakeTelegram,
  FakeTelegramError,
  OWNER_ID,
  waitFor,
  WEBHOOK_SECRET,
} from './fake-telegram.js';

const fake = new FakeTelegram();
await fake.start();
applyAppEnv(telegramEnv(fake.url));
const { createApiApp } = await import('../../src/create-api-app.js');
const { NestFactory } = await import('@nestjs/core');
const { WorkerModule } = await import('../../src/worker/worker.module.js');
const { PG_POOL } = await import('../../src/database/database.module.js');
const { OWNER_WELCOME, STRANGER_REPLY } = await import('../../src/bot/update-router.service.js');
const { NOTIFICATIONS_QUEUE, TELEGRAM_UPDATES_QUEUE } =
  await import('../../src/queue/queue.module.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const CHAT_ID = -1001234567890;
let app: NestExpressApplication;
let worker: INestApplicationContext;
let base: string;
let auth: Record<string, string>;

const db = () => app.get(PG_POOL);

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Json };
}

async function sendUpdate(update: Record<string, unknown>) {
  const res = await fetch(`${base}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
    },
    body: JSON.stringify(update),
  });
  expect(res.status).toBe(200);
}

/** Канал, где бот и владелец — администраторы. */
function happyChannel(botRights: Record<string, boolean> = {}) {
  fake.on('getChat', () => channelChat(CHAT_ID));
  fake.on('getChatMember', (p) =>
    Number(p.user_id) === BOT_ID
      ? adminMember(BOT_ID, botRights)
      : {
          status: 'creator',
          user: { id: OWNER_ID, is_bot: false, first_name: 'O' },
          is_anonymous: false,
        },
  );
}

let updateId = 1000;
function myChatMember(newStatus: 'administrator' | 'left', fromId = OWNER_ID, rights = {}) {
  return {
    update_id: ++updateId,
    my_chat_member: {
      chat: channelChat(CHAT_ID),
      from: { id: fromId, is_bot: false, first_name: 'X' },
      date: Math.floor(Date.now() / 1000),
      old_chat_member: { status: 'left', user: { id: BOT_ID, is_bot: true, first_name: 'bot' } },
      new_chat_member:
        newStatus === 'administrator'
          ? adminMember(BOT_ID, rights)
          : { status: 'left', user: { id: BOT_ID, is_bot: true, first_name: 'bot' } },
    },
  };
}

beforeAll(async () => {
  app = await createApiApp();
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  await db().query('delete from sessions; delete from channels; delete from users;');
  await app.get(TELEGRAM_UPDATES_QUEUE).obliterate({ force: true });
  await app.get(NOTIFICATIONS_QUEUE).obliterate({ force: true });
  worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  await worker.init();
  const res = await fetch(`${base}/api/auth/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: initDataFor(OWNER_ID, BOT_TOKEN) }),
  });
  auth = { authorization: `Bearer ${((await res.json()) as Json).token}` };
});

beforeEach(async () => {
  fake.reset();
  await db().query('delete from channels');
  // Уведомления схлопываются по ключу в 5-минутном окне — для независимости тестов
  // убираем завершённые задания предыдущих тестов.
  const q = app.get(NOTIFICATIONS_QUEUE);
  await q.clean(0, 1000, 'completed');
  await q.clean(0, 1000, 'failed');
});

afterAll(async () => {
  await worker.close();
  await app.close();
  await fake.stop();
});

describe('подключение канала', () => {
  it('по @username: все права → active', async () => {
    happyChannel();
    const r = await api('POST', '/api/channels/connect', { chat: 'https://t.me/test_channel' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      title: 'Тестовый канал',
      username: 'test_channel',
      status: 'active',
    });
    expect(r.body.missingRequired).toEqual([]);
    expect(fake.callsOf('getChat')[0]!.params.chat_id).toBe('@test_channel');
    const list = await api('GET', '/api/channels');
    expect(list.body.items).toHaveLength(1);
  });

  it('не хватает права удаления → rights_missing с перечнем', async () => {
    happyChannel({ can_delete_messages: false });
    const r = await api('POST', '/api/channels/connect', { chat: '@test_channel' });
    expect(r.body.status).toBe('rights_missing');
    expect(r.body.missingRequired).toEqual(['canDeleteMessages']);
  });

  it('владелец не администратор канала → 403', async () => {
    happyChannel();
    fake.on('getChatMember', (p) =>
      Number(p.user_id) === BOT_ID
        ? adminMember(BOT_ID)
        : { status: 'member', user: { id: OWNER_ID, is_bot: false, first_name: 'O' } },
    );
    const r = await api('POST', '/api/channels/connect', { chat: '@test_channel' });
    expect(r.status).toBe(403);
    expect((await api('GET', '/api/channels')).body.items).toHaveLength(0);
  });

  it('бот не администратор → 400; не канал → 400; не найден → 404', async () => {
    happyChannel();
    fake.on('getChatMember', () => ({
      status: 'member',
      user: { id: BOT_ID, is_bot: true, first_name: 'b' },
    }));
    expect((await api('POST', '/api/channels/connect', { chat: '@test_channel' })).status).toBe(
      400,
    );

    fake.on('getChat', () => ({ id: -100555, type: 'supergroup', title: 'Группа' }));
    const group = await api('POST', '/api/channels/connect', { chat: '@some_group' });
    expect(group.status).toBe(400);
    expect(group.body.error.message).toContain('не канал');

    fake.on('getChat', () => {
      throw new FakeTelegramError(400, 'Bad Request: chat not found');
    });
    expect((await api('POST', '/api/channels/connect', { chat: '@nope_channel' })).status).toBe(
      404,
    );
  });

  it('Telegram ограничил частоту → 503 с временем ожидания', async () => {
    fake.on('getChat', () => {
      throw new FakeTelegramError(429, 'Too Many Requests: retry after 7', 7);
    });
    const r = await api('POST', '/api/channels/connect', { chat: '@test_channel' });
    expect(r.status).toBe(503);
    expect(r.body.error.message).toContain('7 с');
  });

  it('повторная проверка после отзыва прав → bot_removed; отключение → disconnected', async () => {
    happyChannel();
    const { body } = await api('POST', '/api/channels/connect', { chat: '@test_channel' });
    fake.on('getChatMember', () => {
      throw new FakeTelegramError(403, 'Forbidden: bot is not a member of the channel chat');
    });
    const checked = await api('POST', `/api/channels/${body.id}/check`);
    expect(checked.body.status).toBe('bot_removed');
    const off = await api('POST', `/api/channels/${body.id}/disconnect`);
    expect(off.body.status).toBe('disconnected');
  });
});

describe('сведения об установке', () => {
  it('возвращают имя бота из getMe и не раскрывают токен', async () => {
    fake.on('getMe', () => ({
      id: BOT_ID,
      is_bot: true,
      first_name: 'Studio',
      username: 'my_studio_bot',
    }));
    const r = await api('GET', '/api/system/info');
    expect(r.body).toMatchObject({ appName: 'Author Studio', botUsername: 'my_studio_bot' });
    expect(JSON.stringify(r.body)).not.toContain(BOT_TOKEN.split(':')[1]);
  });
});

describe('границы доступа', () => {
  it('чужой канал не виден и недоступен по прямому вызову API', async () => {
    const { rows } = await db().query(
      "insert into users (telegram_id, role) values (123123, 'owner') returning id",
    );
    const { rows: ch } = await db().query(
      "insert into channels (owner_id, tg_chat_id, title, status) values ($1, -100999, 'Чужой', 'active') returning id",
      [rows[0].id],
    );
    expect((await api('GET', '/api/channels')).body.items).toHaveLength(0);
    for (const action of ['check', 'disconnect', 'connect']) {
      expect((await api('POST', `/api/channels/${ch[0].id}/${action}`)).status).toBe(404);
    }
    expect((await api('POST', '/api/channels/not-a-uuid/check')).status).toBe(400);
    await db().query('delete from users where telegram_id = 123123');
  });
});

describe('обновления Telegram (webhook → очередь → worker)', () => {
  it('владелец добавил бота в канал → канал обнаружен, владельцу уведомление с кнопкой', async () => {
    await sendUpdate(myChatMember('administrator'));
    const row = await waitFor(async () => {
      const { rows } = await db().query("select * from channels where status = 'detected'");
      return rows[0];
    });
    expect(row.title).toBe('Тестовый канал');
    const msg = await waitFor(() => fake.callsOf('sendMessage')[0]);
    expect(String(msg.params.chat_id)).toBe(String(OWNER_ID));
    expect(String(msg.params.text)).toContain('Бот добавлен в канал «Тестовый канал»');
    expect(JSON.stringify(msg.params.reply_markup)).toContain('https://studio.test/channels/');

    // Подключение обнаруженного канала из приложения.
    happyChannel();
    const r = await api('POST', `/api/channels/${row.id}/connect`);
    expect(r.body.status).toBe('active');
  });

  it('бота добавил не владелец → канал игнорируется', async () => {
    await sendUpdate(myChatMember('administrator', 999));
    await new Promise((r) => setTimeout(r, 800));
    const { rows } = await db().query('select count(*)::int as n from channels');
    expect(rows[0].n).toBe(0);
  });

  it('бота удалили из подключённого канала → bot_removed и предупреждение', async () => {
    happyChannel();
    await api('POST', '/api/channels/connect', { chat: '@test_channel' });
    fake.reset();
    await sendUpdate(myChatMember('left', OWNER_ID));
    await waitFor(async () => {
      const { rows } = await db().query("select 1 from channels where status = 'bot_removed'");
      return rows[0];
    });
    const msg = await waitFor(() => fake.callsOf('sendMessage')[0]);
    expect(String(msg.params.text)).toContain('Бот удалён из канала');
  });

  it('уведомление переживает ответ 429: повтор после retry_after', async () => {
    let attempts = 0;
    fake.on('sendMessage', () => {
      attempts++;
      if (attempts === 1) throw new FakeTelegramError(429, 'Too Many Requests: retry after 1', 1);
      return { message_id: 1 };
    });
    await sendUpdate(myChatMember('administrator'));
    await waitFor(() => (attempts >= 2 ? true : undefined), 15_000);
    expect(attempts).toBe(2);
  });

  it('/start: владельцу — приветствие с кнопкой Mini App, постороннему — отказ', async () => {
    const start = (fromId: number) => ({
      update_id: ++updateId,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: fromId, type: 'private', first_name: 'X' },
        from: { id: fromId, is_bot: false, first_name: 'X' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    });
    await sendUpdate(start(OWNER_ID));
    await sendUpdate(start(31337));
    await waitFor(() => (fake.callsOf('sendMessage').length >= 2 ? true : undefined));
    const byChat = Object.fromEntries(
      fake.callsOf('sendMessage').map((c) => [String(c.params.chat_id), c.params]),
    );
    expect(byChat[String(OWNER_ID)]!.text).toBe(OWNER_WELCOME);
    expect(JSON.stringify(byChat[String(OWNER_ID)]!.reply_markup)).toContain('web_app');
    expect(byChat['31337']!.text).toBe(STRANGER_REPLY);
    expect(byChat['31337']!.reply_markup).toBeUndefined();
  });
});
