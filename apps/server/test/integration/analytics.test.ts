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
const { MetricsCollector } = await import('../../src/analytics/metrics-collector.js');
const { PUBLICATIONS_QUEUE, NOTIFICATIONS_QUEUE, METRICS_QUEUE, TELEGRAM_UPDATES_QUEUE } =
  await import('../../src/queue/queue.module.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const CHAT = -1002000000001;
let app: NestExpressApplication;
let worker: INestApplicationContext;
let base: string;
let auth: Record<string, string>;
let channelId: string;
let updateId = 5000;
const memberCount = 100;
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
  return { status: res.status, body: json, headers: res.headers };
}

async function sendUpdate(update: Record<string, unknown>) {
  const res = await fetch(`${base}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
    },
    body: JSON.stringify({ update_id: ++updateId, ...update }),
  });
  expect(res.status).toBe(200);
}

function handlers() {
  fake.on('getChat', (p) => channelChat(Number(p.chat_id), 'stats_channel', 'Статистика'));
  fake.on('getChatMember', (p) =>
    Number(p.user_id) === BOT_ID
      ? adminMember(BOT_ID)
      : {
          status: 'creator',
          user: { id: OWNER_ID, is_bot: false, first_name: 'O' },
          is_anonymous: false,
        },
  );
  fake.on('getChatMemberCount', () => memberCount);
  fake.on('sendMessage', (p) => ({
    message_id: 900 + updateId,
    date: 0,
    chat: { id: Number(p.chat_id), type: 'channel', title: 'c' },
  }));
}

const ts = (d: Date) => Math.floor(d.getTime() / 1000);

beforeAll(async () => {
  app = await createApiApp();
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  await db().query(
    'delete from channel_member_events; delete from message_metric_snapshots; delete from channel_messages; delete from channel_metric_snapshots; delete from publications; delete from posts; delete from sessions; delete from channels; delete from users;',
  );
  for (const q of [
    PUBLICATIONS_QUEUE,
    NOTIFICATIONS_QUEUE,
    METRICS_QUEUE,
    TELEGRAM_UPDATES_QUEUE,
  ]) {
    await app.get(q).obliterate({ force: true });
  }
  handlers();
  worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  await worker.init();
  const res = await fetch(`${base}/api/auth/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: initDataFor(OWNER_ID, BOT_TOKEN) }),
  });
  auth = { authorization: `Bearer ${((await res.json()) as Json).token}` };
  channelId = (await api('POST', '/channels/connect', { chat: String(CHAT) })).body.id;
});

beforeEach(() => {
  fake.reset();
  handlers();
});

afterAll(async () => {
  await worker.close();
  await app.close();
  await fake.stop();
});

describe('сбор числа подписчиков', () => {
  it('первый снимок — сразу после подключения канала', async () => {
    const row = await waitFor(async () => {
      const { rows } = await db().query(
        "select value, source from channel_metric_snapshots where channel_id = $1 and metric = 'subscribers'",
        [channelId],
      );
      return rows[0];
    });
    expect(row).toEqual({ value: 100, source: 'telegram_api' });
  });

  it('ошибка Telegram не записывается нулём', async () => {
    fake.on('getChatMemberCount', () => {
      throw new FakeTelegramError(400, 'Bad Request: chat not found');
    });
    const before = await db().query('select count(*)::int n from channel_metric_snapshots');
    expect(await worker.get(MetricsCollector).collectChannel(channelId)).toBe(false);
    const after = await db().query('select count(*)::int n from channel_metric_snapshots');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe('сводка канала', () => {
  it('ряд по дням: дни без измерений — null, изменение за период, текущее значение и покрытие', async () => {
    await db().query('delete from channel_metric_snapshots where channel_id = $1', [channelId]);
    const day = 86_400_000;
    const now = Date.now();
    for (const [ago, v] of [
      [6, 80],
      [5, 82],
      [3, 90],
      [0, 95],
    ] as const) {
      await db().query(
        "insert into channel_metric_snapshots (channel_id, metric, value, source, measured_at) values ($1, 'subscribers', $2, 'telegram_api', $3)",
        [channelId, v, new Date(now - ago * day - 60_000)],
      );
    }
    const r = await api('GET', `/analytics/channels/${channelId}/overview?days=7`);
    expect(r.status).toBe(200);
    expect(r.body.current.value).toBe(95);
    expect(r.body.periodChange).toMatchObject({ from: 80, to: 95, delta: 15 });
    expect(r.body.series).toHaveLength(7);
    expect(r.body.series.filter((p: Json) => p.subscribers === null)).toHaveLength(3);
    expect(r.body.joinsTotal).toBeNull(); // событий вступлений ещё не было
    expect(r.body.coverage.subscribersSince).toBeTruthy();
  });

  it('недопустимый период → 400; чужой канал → 404', async () => {
    expect((await api('GET', `/analytics/channels/${channelId}/overview?days=13`)).status).toBe(
      400,
    );
    expect(
      (await api('GET', `/analytics/channels/00000000-0000-4000-8000-000000000001/overview?days=7`))
        .status,
    ).toBe(404);
  });
});

describe('обновления Telegram → аналитика', () => {
  it('channel_post, реакции и вступления/выходы записываются; данные подписчиков не сохраняются', async () => {
    const date = ts(new Date(Date.now() - 3600_000));
    await sendUpdate({
      channel_post: {
        message_id: 501,
        date,
        chat: channelChat(CHAT),
        text: '=Опасная формула\nвторая строка',
      },
    });
    await sendUpdate({
      message_reaction_count: {
        chat: channelChat(CHAT),
        message_id: 501,
        date,
        reactions: [
          { type: { type: 'emoji', emoji: '👍' }, total_count: 7 },
          { type: { type: 'emoji', emoji: '🔥' }, total_count: 3 },
        ],
      },
    });
    const user = { id: 424242, is_bot: false, first_name: 'Подписчик', username: 'secret_user' };
    await sendUpdate({
      chat_member: {
        chat: channelChat(CHAT),
        from: user,
        date,
        old_chat_member: { status: 'left', user },
        new_chat_member: { status: 'member', user },
        invite_link: {
          invite_link: 'https://t.me/+abc',
          creator: { id: OWNER_ID, is_bot: false, first_name: 'O' },
          creates_join_request: false,
          is_primary: false,
          is_revoked: false,
          name: 'Реклама в канале X',
        },
      },
    });
    await sendUpdate({
      chat_member: {
        chat: channelChat(CHAT),
        from: user,
        date,
        old_chat_member: { status: 'member', user },
        new_chat_member: { status: 'left', user },
      },
    });

    await waitFor(
      async () =>
        (await db().query('select 1 from channel_member_events where kind = $1', ['leave']))
          .rows[0],
    );
    const { rows: msgs } = await db().query(
      'select message_id, summary, source from channel_messages where channel_id = $1',
      [channelId],
    );
    expect(msgs).toContainEqual({
      message_id: 501,
      summary: '=Опасная формула',
      source: 'telegram',
    });
    const { rows: reactions } = await db().query(
      "select value, details from message_metric_snapshots where metric = 'reactions'",
    );
    expect(reactions[0]).toEqual({ value: 10, details: { '👍': 7, '🔥': 3 } });
    const { rows: events } = await db().query('select * from channel_member_events order by id');
    expect(events.map((e: Json) => [e.kind, e.invite_link_name])).toEqual([
      ['join', 'Реклама в канале X'],
      ['leave', null],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/424242|secret_user|Подписчик/);

    const overview = await api('GET', `/analytics/channels/${channelId}/overview?days=7`);
    expect(overview.body.joinsTotal).toBe(1);
    expect(overview.body.leavesTotal).toBe(1);
    expect(overview.body.markers.some((m: Json) => m.summary === '=Опасная формула')).toBe(true);
  });

  it('публикация из приложения попадает в аналитику с привязкой к отправке', async () => {
    const draft = await api('POST', '/posts', {
      content: {
        text: 'Пост из приложения',
        entities: [],
        media: [],
        buttons: [],
        disableLinkPreview: false,
      },
    });
    const pub = await api('POST', `/posts/${draft.body.id}/publish`, {
      channelIds: [channelId],
      version: draft.body.version,
    });
    const row = await waitFor(async () => {
      const { rows } = await db().query(
        'select publication_id, source, summary from channel_messages where publication_id = $1',
        [pub.body.items[0].id],
      );
      return rows[0];
    });
    expect(row).toMatchObject({ source: 'app', summary: 'Пост из приложения' });
  });
});

describe('показатели постов и ручной ввод', () => {
  it('ручные просмотры → ERR от подписчиков на момент поста; источник «вручную»', async () => {
    // Ближайшее измерение до поста (за 2 ч до него); более старые не используются.
    await db().query(
      "insert into channel_metric_snapshots (channel_id, metric, value, source, measured_at) values ($1, 'subscribers', 94, 'telegram_api', now() - interval '3 hours')",
      [channelId],
    );
    expect(
      (
        await api('POST', `/analytics/channels/${channelId}/manual`, {
          messageId: 501,
          views: 45,
          forwards: 2,
        })
      ).status,
    ).toBe(204);
    const r = await api('GET', `/analytics/channels/${channelId}/posts?days=7&sort=views`);
    const post = r.body.items.find((p: Json) => p.primaryMessageId === 501);
    expect(post.views).toMatchObject({ value: 45, source: 'manual' });
    expect(post.forwards.value).toBe(2);
    expect(post.reactions).toMatchObject({ value: 10, source: 'telegram_api' });
    expect(post.subscribersAtPost).toBe(94);
    expect(post.err).toBe(47.9);
    expect(r.body.items[0].primaryMessageId).toBe(501); // сортировка по просмотрам
  });

  it('ручной ввод для неизвестного поста → 404, без значений → 400', async () => {
    expect(
      (await api('POST', `/analytics/channels/${channelId}/manual`, { messageId: 99999, views: 1 }))
        .status,
    ).toBe(404);
    expect(
      (await api('POST', `/analytics/channels/${channelId}/manual`, { messageId: 501 })).status,
    ).toBe(400);
  });

  it('лучшее время: мало постов — вывода нет', async () => {
    const r = await api(
      'GET',
      `/analytics/channels/${channelId}/best-time?days=90&metric=reactions`,
    );
    expect(r.body.confidence).toBe('insufficient');
    expect(r.body.best).toBeNull();
    expect(r.body.cells).toHaveLength(56);
  });

  it('CSV: заголовки на русском, защита от формул в ячейках', async () => {
    const r = await api('GET', `/analytics/channels/${channelId}/posts.csv?days=7`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
    const text = String(r.body);
    expect(text).toContain('Реакции;Просмотры (вручную)');
    expect(text).toContain("'=Опасная формула");
    expect(text).not.toMatch(/;=Опасная/);
  });

  it('экспорт в чат с ботом: документ уходит владельцу', async () => {
    fake.on('sendDocument', () => ({
      message_id: 1,
      date: 0,
      chat: { id: OWNER_ID, type: 'private' },
    }));
    const r = await api('POST', `/analytics/channels/${channelId}/export?days=7`);
    expect(r.status).toBe(204);
    const call = fake.callsOf('sendDocument')[0]!;
    expect(call.params.multipart).toBe(true);
    expect(String(call.params.raw)).toContain(String(OWNER_ID));
    expect(String(call.params.raw)).toContain('posts-');
  });
});
