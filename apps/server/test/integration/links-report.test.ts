import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/** Отслеживаемые ссылки (переход, учёт кликов без ботов) и сводный отчёт статистики. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const CHAT = -1002000000555;
const fake = new FakeTelegram();
await fake.start();
applyAppEnv(telegramEnv(fake.url));
const { createApiApp } = await import('../../src/create-api-app.js');
const { PG_POOL } = await import('../../src/database/database.module.js');

let app: NestExpressApplication;
let base: string;
let auth: Record<string, string>;
let channelId: string;
const db = () => app.get(PG_POOL);
const HUMAN =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

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
  return { status: res.status, body: json };
}

const visit = (slug: string, ua: string, ip = '203.0.113.7') =>
  fetch(`${base}/api/r/${slug}`, {
    redirect: 'manual',
    headers: { 'user-agent': ua, 'x-forwarded-for': ip },
  });

beforeAll(async () => {
  app = await createApiApp();
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  await db().query(
    'delete from link_clicks; delete from tracked_links; delete from message_metric_snapshots; delete from channel_messages; delete from channel_metric_snapshots; delete from publications; delete from posts; delete from sessions; delete from channels; delete from users;',
  );
  fake.on('getChat', (p) => channelChat(Number(p.chat_id), 'links_channel', 'Канал ссылок'));
  fake.on('getChatMember', (p) =>
    Number(p.user_id) === BOT_ID
      ? adminMember(BOT_ID)
      : {
          status: 'creator',
          user: { id: OWNER_ID, is_bot: false, first_name: 'O' },
          is_anonymous: false,
        },
  );
  fake.on('getChatMemberCount', () => 500);
  const res = await fetch(`${base}/api/auth/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: initDataFor(OWNER_ID, BOT_TOKEN) }),
  });
  auth = { authorization: `Bearer ${((await res.json()) as Json).token}` };
  channelId = (await api('POST', '/channels/connect', { chat: String(CHAT) })).body.id;
});

afterAll(async () => {
  await app.close();
  await fake.stop();
});

describe('отслеживаемые ссылки', () => {
  let slug: string;
  let id: string;

  it('создание: короткий адрес на домене установки; неверный адрес → 400', async () => {
    const bad = await api('POST', '/links', { title: 'x', targetUrl: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    const r = await api('POST', '/links', {
      title: 'Партнёр',
      targetUrl: 'https://partner.example/landing?utm=tg',
      channelId,
      isAd: true,
    });
    expect(r.status).toBe(201);
    expect(r.body.shortUrl).toMatch(/^https:\/\/studio\.test\/r\/[A-Za-z0-9]{8}$/);
    slug = r.body.shortUrl.split('/').at(-1);
    id = r.body.id;
  });

  it('переход: 302 на адрес; бот-превью не считается; повтор за 30 с — тоже', async () => {
    const r = await visit(slug, HUMAN);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://partner.example/landing?utm=tg');
    expect((await visit(slug, 'TelegramBot (like TwitterBot)')).status).toBe(302);
    await visit(slug, HUMAN); // тот же посетитель сразу же
    await visit(slug, HUMAN, '198.51.100.9'); // другой посетитель
    const { rows } = await db().query('select visitor_hash from link_clicks');
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain('203.0.113.7');
    const list = await api('GET', '/links?days=7');
    expect(list.body.items[0]).toMatchObject({ title: 'Партнёр', total: { clicks: 2, unique: 2 } });
  });

  it('неизвестная и отключённая ссылка → 404; чужая ссылка не удаляется', async () => {
    expect((await visit('nonexist1', HUMAN)).status).toBe(404);
    expect((await api('DELETE', '/links/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await api('DELETE', `/links/${id}`)).status).toBe(204);
    expect((await visit(slug, HUMAN)).status).toBe(404);
  });

  it('переход доступен без сессии, управление ссылками — нет', async () => {
    expect((await fetch(`${base}/api/links`)).status).toBe(401);
  });
});

describe('сводный отчёт', () => {
  it('шесть разделов; рубрики, реклама и просмотры через N часов из снимков', async () => {
    const posted = new Date(Date.now() - 30 * 3600_000);
    await db().query(
      "insert into channel_metric_snapshots (channel_id, metric, value, source, measured_at) values ($1, 'subscribers', 480, 'telegram_api', $2), ($1, 'subscribers', 500, 'telegram_api', now())",
      [channelId, new Date(posted.getTime() - 3600_000)],
    );
    await db().query(
      "insert into channel_messages (channel_id, message_id, posted_at, summary, source, content_kind, hashtags, is_ad) values ($1, 7, $2, 'Пост #кофе', 'telegram', 'photo', '{кофе}', true)",
      [channelId, posted],
    );
    await db().query(
      "insert into message_metric_snapshots (channel_id, message_id, metric, value, source, measured_at) values ($1, 7, 'views', 50, 'mtproto', $2), ($1, 7, 'views', 240, 'mtproto', $3)",
      [
        channelId,
        new Date(posted.getTime() + 3600_000),
        new Date(posted.getTime() + 24 * 3600_000),
      ],
    );
    const r = await api('GET', `/analytics/channels/${channelId}/report?days=30`);
    expect(r.status).toBe(200);
    const b = r.body;
    expect(Object.keys(b)).toEqual(
      expect.arrayContaining(['audience', 'reach', 'engagement', 'effectiveness', 'ads', 'links']),
    );
    expect(b.audience.current.value).toBe(500);
    expect(b.reach.posts[0]).toMatchObject({
      kind: 'photo',
      rubrics: ['кофе'],
      isAd: true,
      views: 240,
    });
    expect(b.reach.posts[0].viewsAt).toMatchObject({ h1: 50, h24: 240, h48: null });
    expect(b.reach.posts[0].reachPct).toBe(50);
    expect(b.ads).toMatchObject({ count: 1, avgViews: 240 });
    expect(b.effectiveness.rubrics[0]).toMatchObject({ key: 'кофе', posts: 1 });
  });

  it('чужой канал → 404', async () => {
    const r = await api(
      'GET',
      '/analytics/channels/00000000-0000-4000-8000-000000000000/report?days=30',
    );
    expect(r.status).toBe(404);
  });
});
