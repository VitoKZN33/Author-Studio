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
  FakeTelegramDrop,
  FakeTelegramError,
  OWNER_ID,
  waitFor,
} from './fake-telegram.js';

const fake = new FakeTelegram();
await fake.start();
applyAppEnv(telegramEnv(fake.url));
const { createApiApp } = await import('../../src/create-api-app.js');
const { NestFactory } = await import('@nestjs/core');
const { WorkerModule } = await import('../../src/worker/worker.module.js');
const { PG_POOL } = await import('../../src/database/database.module.js');
const { PUBLICATIONS_QUEUE, NOTIFICATIONS_QUEUE } = await import('../../src/queue/queue.module.js');
const { PublicationExecutor } =
  await import('../../src/publishing/publication-executor.service.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let app: NestExpressApplication;
let worker: INestApplicationContext | null = null;
let base: string;
let auth: Record<string, string>;
let channelA: string;
let channelB: string;
let messageSeq = 100;
const db = () => app.get(PG_POOL);
/** Отправки в каналы (уведомления владельцу тоже идут через sendMessage). */
const channelSends = (text?: string) =>
  fake
    .callsOf('sendMessage')
    .filter((c) => Number(c.params.chat_id) < 0 && (text === undefined || c.params.text === text));

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Json };
}

async function upload(bytes: Buffer, name: string) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const res = await fetch(`${base}/api/media`, { method: 'POST', headers: auth, body: form });
  return { status: res.status, body: (await res.json()) as Json };
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);

async function startWorker() {
  worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  await worker.init();
}
async function stopWorker() {
  await worker?.close();
  worker = null;
}

function textContent(text: string, extra: Record<string, unknown> = {}) {
  return { text, entities: [], media: [], buttons: [], disableLinkPreview: false, ...extra };
}

async function draft(content = textContent('Привет, мир')) {
  const r = await api('POST', '/posts', { content });
  expect(r.status).toBe(201);
  return r.body as { id: string; version: number };
}

async function pubStatus(id: string): Promise<string> {
  const { rows } = await db().query('select status from publications where id = $1', [id]);
  return rows[0]?.status;
}

function defaultHandlers() {
  fake.on('getChat', (p) => channelChat(Number(p.chat_id)));
  fake.on('getChatMember', (p) =>
    Number(p.user_id) === BOT_ID
      ? adminMember(BOT_ID)
      : {
          status: 'creator',
          user: { id: OWNER_ID, is_bot: false, first_name: 'O' },
          is_anonymous: false,
        },
  );
  const reply = (p: Record<string, unknown>) => ({
    message_id: ++messageSeq,
    date: 0,
    chat: { id: Number(p.chat_id ?? 0), type: 'channel', title: 'c' },
  });
  fake.on('sendMessage', reply);
  fake.on('sendPhoto', (p) => ({
    ...reply(p),
    photo: [{ file_id: 'PHOTO_FILE_ID', file_unique_id: 'u', width: 1, height: 1 }],
  }));
  fake.on('sendMediaGroup', (p) =>
    [0, 1].map(() => ({
      ...reply(p),
      photo: [{ file_id: `G${messageSeq}`, file_unique_id: 'u', width: 1, height: 1 }],
    })),
  );
}

beforeAll(async () => {
  app = await createApiApp();
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  await db().query(
    'delete from publications; delete from posts; delete from media_assets; delete from sessions; delete from channels; delete from users;',
  );
  await app.get(PUBLICATIONS_QUEUE).obliterate({ force: true });
  await app.get(NOTIFICATIONS_QUEUE).obliterate({ force: true });
  const res = await fetch(`${base}/api/auth/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: initDataFor(OWNER_ID, BOT_TOKEN) }),
  });
  auth = { authorization: `Bearer ${((await res.json()) as Json).token}` };
  defaultHandlers();
  channelA = (await api('POST', '/channels/connect', { chat: '-1001000000001' })).body.id;
  channelB = (await api('POST', '/channels/connect', { chat: '-1001000000002' })).body.id;
  expect(channelA && channelB).toBeTruthy();
  await startWorker();
});

beforeEach(() => {
  fake.reset();
  defaultHandlers();
});

afterAll(async () => {
  await stopWorker();
  await app.close();
  await fake.stop();
});

describe('черновики', () => {
  it('сохранение увеличивает версию; устаревшая версия → 409 с актуальным содержимым', async () => {
    const d = await draft();
    const saved = await api('PUT', `/posts/${d.id}`, {
      content: textContent('Вторая версия'),
      version: d.version,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(d.version + 1);
    const stale = await api('PUT', `/posts/${d.id}`, {
      content: textContent('Из другого окна'),
      version: d.version,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.current.content.text).toBe('Вторая версия');
  });

  it('копия, удаление, список с кратким содержанием', async () => {
    const d = await draft(textContent('Оригинал\nвторая строка'));
    const copy = await api('POST', `/posts/${d.id}/duplicate`);
    expect(copy.body.content.text).toBe('Оригинал\nвторая строка');
    expect((await api('DELETE', `/posts/${copy.body.id}`)).status).toBe(204);
    const list = await api('GET', '/posts');
    const item = list.body.items.find((i: Json) => i.id === d.id);
    expect(item.summary).toBe('Оригинал');
    expect(list.body.items.find((i: Json) => i.id === copy.body.id)).toBeUndefined();
  });

  it('медиафайл чужого или несуществующего id в содержимом → 400', async () => {
    const r = await api('POST', '/posts', {
      content: textContent('x', { media: [{ assetId: '00000000-0000-4000-8000-000000000999' }] }),
    });
    expect(r.status).toBe(400);
  });
});

describe('медиафайлы', () => {
  it('JPEG принимается и отдаётся владельцу; HTML под видом .jpg — отклоняется', async () => {
    const ok = await upload(JPEG, 'photo.jpg');
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ kind: 'photo', mime: 'image/jpeg', size: JPEG.length });
    const file = await fetch(`${base}/api/media/${ok.body.id}`, { headers: auth });
    expect(file.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await file.arrayBuffer()).equals(JPEG)).toBe(true);
    expect((await fetch(`${base}/api/media/${ok.body.id}`)).status).toBe(401);

    const bad = await upload(Buffer.from('<html><script>alert(1)</script>'), 'evil.jpg');
    expect(bad.status).toBe(400);
  });

  it('миниатюра: настоящее фото → WebP до 480 px; повреждённое → 404; без сессии → 401', async () => {
    const { default: sharp } = await import('sharp');
    const png = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#0e9f8e' },
    })
      .png()
      .toBuffer();
    const id = (await upload(png, 'big.png')).body.id;
    const thumb = await fetch(`${base}/api/media/${id}/thumb`, { headers: auth });
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/webp');
    const meta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    expect(meta.width).toBeLessThanOrEqual(480);
    // Повторный запрос — из готового файла.
    expect((await fetch(`${base}/api/media/${id}/thumb`, { headers: auth })).status).toBe(200);
    expect((await fetch(`${base}/api/media/${id}/thumb`)).status).toBe(401);

    const broken = (await upload(JPEG, 'broken.jpg')).body.id;
    expect((await fetch(`${base}/api/media/${broken}/thumb`, { headers: auth })).status).toBe(404);
  });

  it('фото больше 10 МБ → 413', async () => {
    const big = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(10 * 1024 * 1024 + 10),
    ]);
    expect((await upload(big, 'big.jpg')).status).toBe(413);
  });
});

describe('публикация', () => {
  it('сразу в два канала: отдельный результат по каждому, текст с форматированием и кнопкой', async () => {
    const d = await draft(
      textContent('Жирный текст', {
        entities: [{ type: 'bold', offset: 0, length: 6 }],
        buttons: [[{ text: 'Сайт', url: 'https://example.ru' }]],
      }),
    );
    const r = await api('POST', `/posts/${d.id}/publish`, {
      channelIds: [channelA, channelB],
      version: d.version,
    });
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
    for (const p of r.body.items)
      await waitFor(async () => (await pubStatus(p.id)) === 'published');
    const sends = channelSends('Жирный текст');
    expect(sends.map((c) => Number(c.params.chat_id)).sort((a, b) => a - b)).toEqual([
      -1001000000002, -1001000000001,
    ]);
    expect(sends[0]!.params.entities).toEqual([{ type: 'bold', offset: 0, length: 6 }]);
    expect(JSON.stringify(sends[0]!.params.reply_markup)).toContain('https://example.ru');
    const view = await api('GET', `/posts/${d.id}`);
    expect(
      view.body.publications.every(
        (p: Json) => p.status === 'published' && p.messageIds.length === 1,
      ),
    ).toBe(true);
  });

  it('повторная публикация, пока предыдущая активна → 409; невалидный пост → 422', async () => {
    const d = await draft();
    const at = new Date(Date.now() + 3600_000).toISOString();
    expect(
      (
        await api('POST', `/posts/${d.id}/publish`, {
          channelIds: [channelA],
          scheduledAt: at,
          version: d.version,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api('POST', `/posts/${d.id}/publish`, {
          channelIds: [channelA],
          scheduledAt: at,
          version: d.version,
        })
      ).status,
    ).toBe(409);
    const long = await draft(textContent('я'.repeat(4097)));
    const bad = await api('POST', `/posts/${long.id}/publish`, {
      channelIds: [channelA],
      version: long.version,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toContain('4096');
  });

  it('время в прошлом и старая версия черновика отклоняются', async () => {
    const d = await draft();
    const past = await api('POST', `/posts/${d.id}/publish`, {
      channelIds: [channelA],
      scheduledAt: new Date(Date.now() - 3600_000).toISOString(),
      version: d.version,
    });
    expect(past.status).toBe(400);
    expect(
      (
        await api('POST', `/posts/${d.id}/publish`, {
          channelIds: [channelA],
          version: d.version + 5,
        })
      ).status,
    ).toBe(409);
  });

  it('отложенная: не раньше времени; перенос — отправка один раз в новое время; отмена — без отправки', async () => {
    const d = await draft(textContent('Отложенный'));
    const r = await api('POST', `/posts/${d.id}/publish`, {
      channelIds: [channelA, channelB],
      scheduledAt: new Date(Date.now() + 1500).toISOString(),
      version: d.version,
    });
    const [pa, pb] = r.body.items as Json[];
    await api('POST', `/publications/${pb.id}/cancel`);
    const moved = await api('POST', `/publications/${pa.id}/reschedule`, {
      scheduledAt: new Date(Date.now() + 4500).toISOString(),
    });
    expect(moved.status).toBe(200);
    // Старое задание (через 1,5 с) срабатывает и ничего не делает: время перенесено.
    await new Promise((r) => setTimeout(r, 2500));
    expect(await pubStatus(pa.id)).toBe('scheduled');
    await waitFor(async () => (await pubStatus(pa.id)) === 'published', 8000);
    expect(channelSends('Отложенный')).toHaveLength(1);
    expect(await pubStatus(pb.id)).toBe('cancelled');
    // Отправленное или отменённое уже нельзя отменить/перенести.
    expect((await api('POST', `/publications/${pa.id}/cancel`)).status).toBe(409);
  });

  it('альбом: загрузка файлов, затем повторная отправка по file_id без выгрузки', async () => {
    const a = (await upload(JPEG, 'a.jpg')).body.id;
    const b = (await upload(Buffer.concat([JPEG, Buffer.from([2])]), 'b.jpg')).body.id;
    const d = await draft(
      textContent('Подпись альбома', { media: [{ assetId: a }, { assetId: b }] }),
    );
    const first = await api('POST', `/posts/${d.id}/publish`, {
      channelIds: [channelA],
      version: d.version,
    });
    await waitFor(async () => (await pubStatus(first.body.items[0].id)) === 'published');
    expect(fake.callsOf('sendMediaGroup')[0]!.params.multipart).toBe(true);
    const { rows } = await db().query(
      'select telegram_file_id from media_assets where id = any($1)',
      [[a, b]],
    );
    expect(rows.every((r: Json) => r.telegram_file_id)).toBe(true);
    const second = await api('POST', `/posts/${d.id}/publish`, {
      channelIds: [channelB],
      version: d.version,
    });
    await waitFor(async () => (await pubStatus(second.body.items[0].id)) === 'published');
    const call = fake.callsOf('sendMediaGroup')[1]!;
    expect(call.params.multipart).toBeUndefined();
    expect((call.params.media as Json[])[0].caption).toBe('Подпись альбома');
  });
});

describe('надёжность отправки', () => {
  it('429: повтор после retry_after, пост отправлен ровно один раз', async () => {
    let calls = 0;
    fake.on('sendMessage', (p) => {
      if (Number(p.chat_id) > 0)
        return { message_id: 1, date: 0, chat: { id: Number(p.chat_id), type: 'private' } };
      calls++;
      if (calls === 1) throw new FakeTelegramError(429, 'Too Many Requests: retry after 1', 1);
      return {
        message_id: ++messageSeq,
        date: 0,
        chat: { id: Number(p.chat_id), type: 'channel', title: 'c' },
      };
    });
    const d = await draft(textContent('Лимит'));
    const r = await api('POST', `/posts/${d.id}/publish`, {
      channelIds: [channelA],
      version: d.version,
    });
    await waitFor(async () => (await pubStatus(r.body.items[0].id)) === 'published', 10_000);
    expect(calls).toBe(2);
    const { rows } = await db().query(
      'select result from publication_attempts where publication_id = $1 order by id',
      [r.body.items[0].id],
    );
    expect(rows.map((x: Json) => x.result)).toEqual(['rate_limited', 'ok']);
  });

  it('обрыв связи после отправки → ambiguous без автоповтора; «отправить заново» → один повтор', async () => {
    fake.on('sendMessage', (p) => {
      if (Number(p.chat_id) > 0)
        return { message_id: 1, date: 0, chat: { id: Number(p.chat_id), type: 'private' } };
      throw new FakeTelegramDrop();
    });
    const d = await draft(textContent('Обрыв'));
    const r = await api('POST', `/posts/${d.id}/publish`, {
      channelIds: [channelA],
      version: d.version,
    });
    const id = r.body.items[0].id;
    await waitFor(async () => (await pubStatus(id)) === 'ambiguous');
    await new Promise((res) => setTimeout(res, 1500));
    expect(channelSends('Обрыв')).toHaveLength(1);
    const notice = await waitFor(() =>
      fake
        .callsOf('sendMessage')
        .find(
          (c) =>
            Number(c.params.chat_id) === OWNER_ID && String(c.params.text).includes('Неизвестно'),
        ),
    );
    expect(notice).toBeTruthy();

    defaultHandlers();
    const resend = await api('POST', `/publications/${id}/resolve`, { outcome: 'resend' });
    expect(resend.status).toBe(200);
    await waitFor(async () => (await pubStatus(id)) === 'published');
  });

  it('ambiguous → «опубликовано» отмечается без повторной отправки', async () => {
    fake.on('sendMessage', (p) => {
      if (Number(p.chat_id) > 0)
        return { message_id: 1, date: 0, chat: { id: Number(p.chat_id), type: 'private' } };
      throw new FakeTelegramDrop();
    });
    const d = await draft(textContent('Проверено вручную'));
    const id = (
      await api('POST', `/posts/${d.id}/publish`, { channelIds: [channelA], version: d.version })
    ).body.items[0].id;
    await waitFor(async () => (await pubStatus(id)) === 'ambiguous');
    defaultHandlers();
    const before = channelSends('Проверено вручную').length;
    const r = await api('POST', `/publications/${id}/resolve`, { outcome: 'published' });
    expect(r.body.status).toBe('published');
    await new Promise((res) => setTimeout(res, 800));
    expect(channelSends('Проверено вручную')).toHaveLength(before);
  });

  it('Telegram недоступен (соединение отклонено) → безопасный повтор, затем публикация', async () => {
    const d = await draft(textContent('После простоя'));
    await fake.pause();
    const id = (
      await api('POST', `/posts/${d.id}/publish`, { channelIds: [channelA], version: d.version })
    ).body.items[0].id;
    await waitFor(async () => {
      const { rows } = await db().query(
        'select result from publication_attempts where publication_id = $1',
        [id],
      );
      return rows.some((r: Json) => r.result === 'retryable');
    });
    expect(await pubStatus(id)).toBe('scheduled');
    await fake.resume();
    // Первый безопасный повтор — через 30 с; ускоряем, выполняя задание напрямую.
    await db().query(
      "update publications set scheduled_at = now() - interval '2 minutes' where id = $1",
      [id],
    );
    await worker!.get(PublicationExecutor).reconcile();
    await waitFor(async () => (await pubStatus(id)) === 'published', 10_000);
  });

  it('постоянная ошибка Telegram → failed с понятной причиной; «повторить» отправляет заново', async () => {
    fake.on('sendMessage', (p) => {
      if (Number(p.chat_id) > 0)
        return { message_id: 1, date: 0, chat: { id: Number(p.chat_id), type: 'private' } };
      throw new FakeTelegramError(
        400,
        'Bad Request: not enough rights to send text messages to the chat',
      );
    });
    const d = await draft(textContent('Нет прав'));
    const id = (
      await api('POST', `/posts/${d.id}/publish`, { channelIds: [channelA], version: d.version })
    ).body.items[0].id;
    await waitFor(async () => (await pubStatus(id)) === 'failed');
    const view = await api('GET', `/posts/${d.id}`);
    expect(view.body.publications[0].lastError).toBe('У бота нет прав на публикацию в канале');
    defaultHandlers();
    await api('POST', `/publications/${id}/retry`);
    await waitFor(async () => (await pubStatus(id)) === 'published');
  });

  it('одновременный запуск одной отправки двумя исполнителями → один пост', async () => {
    const d = await draft(textContent('Гонка'));
    const { rows } = await db().query(
      "insert into publications (owner_id, post_id, channel_id, status, scheduled_at) select owner_id, id, $2, 'scheduled', now() from posts where id = $1 returning id",
      [d.id, channelA],
    );
    const ex = worker!.get(PublicationExecutor);
    const results = await Promise.all([
      ex.execute(rows[0].id),
      ex.execute(rows[0].id),
      ex.execute(rows[0].id),
    ]);
    expect(results.filter((r) => r === 'published')).toHaveLength(1);
    expect(channelSends('Гонка')).toHaveLength(1);
  });

  it('перезапуск worker: запланированное во время простоя отправляется после запуска один раз', async () => {
    await stopWorker();
    const d = await draft(textContent('После перезапуска'));
    const id = (
      await api('POST', `/posts/${d.id}/publish`, {
        channelIds: [channelA],
        scheduledAt: new Date(Date.now() + 1000).toISOString(),
        version: d.version,
      })
    ).body.items[0].id;
    await new Promise((r) => setTimeout(r, 2000));
    expect(await pubStatus(id)).toBe('scheduled');
    await startWorker();
    await waitFor(async () => (await pubStatus(id)) === 'published', 10_000);
    expect(channelSends('После перезапуска')).toHaveLength(1);
  });

  it('реконсилятор: задание потеряно в Redis → отправка; зависшая в sending → ambiguous', async () => {
    const d = await draft(textContent('Без задания'));
    const { rows } = await db().query(
      "insert into publications (owner_id, post_id, channel_id, status, scheduled_at) select owner_id, id, $2, 'scheduled', now() - interval '5 minutes' from posts where id = $1 returning id",
      [d.id, channelA],
    );
    const d2 = await draft(textContent('Зависла'));
    const { rows: stuck } = await db().query(
      "insert into publications (owner_id, post_id, channel_id, status, scheduled_at, updated_at) select owner_id, id, $2, 'sending', now(), now() - interval '10 minutes' from posts where id = $1 returning id",
      [d2.id, channelA],
    );
    const result = await worker!.get(PublicationExecutor).reconcile();
    expect(result.requeued).toBeGreaterThanOrEqual(1);
    expect(result.stuck).toBe(1);
    await waitFor(async () => (await pubStatus(rows[0].id)) === 'published');
    expect(await pubStatus(stuck[0].id)).toBe('ambiguous');
  });

  it('канал потерял права до отправки → failed без обращения к Telegram', async () => {
    const d = await draft(textContent('Канал без прав'));
    await db().query("update channels set status = 'rights_missing' where id = $1", [channelB]);
    try {
      const { rows } = await db().query(
        "insert into publications (owner_id, post_id, channel_id, status, scheduled_at) select owner_id, id, $2, 'scheduled', now() from posts where id = $1 returning id",
        [d.id, channelB],
      );
      expect(await worker!.get(PublicationExecutor).execute(rows[0].id)).toBe('failed');
      expect(channelSends('Канал без прав')).toHaveLength(0);
    } finally {
      await db().query("update channels set status = 'active' where id = $1", [channelB]);
    }
  });
});

describe('настройки уведомлений', () => {
  it('отключённые уведомления об успехе не отправляются; ошибки — по своей настройке', async () => {
    const off = await api('PUT', '/settings/notifications', { publishSuccess: false });
    expect(off.body).toEqual({ publishSuccess: false, publishProblems: true, integration: true });
    expect((await api('PUT', '/settings/notifications', { unknown: true })).status).toBe(400);
    const d = await draft(textContent('Тихая публикация'));
    const id = (
      await api('POST', `/posts/${d.id}/publish`, { channelIds: [channelA], version: d.version })
    ).body.items[0].id;
    await waitFor(async () => (await pubStatus(id)) === 'published');
    await new Promise((r) => setTimeout(r, 1500));
    const ownerMessages = fake
      .callsOf('sendMessage')
      .filter((c) => Number(c.params.chat_id) === OWNER_ID);
    expect(
      ownerMessages.filter((c) => String(c.params.text).includes('Тихая публикация')),
    ).toHaveLength(0);
    await api('PUT', '/settings/notifications', { publishSuccess: true });
  });

  it('уведомление об успехе приходит, когда включено', async () => {
    const d = await draft(textContent('Громкая публикация'));
    const id = (
      await api('POST', `/posts/${d.id}/publish`, { channelIds: [channelA], version: d.version })
    ).body.items[0].id;
    await waitFor(async () => (await pubStatus(id)) === 'published');
    const msg = await waitFor(() =>
      fake
        .callsOf('sendMessage')
        .find(
          (c) =>
            Number(c.params.chat_id) === OWNER_ID &&
            String(c.params.text).includes('Громкая публикация'),
        ),
    );
    expect(String(msg.params.text)).toContain('✅ Опубликовано');
  });
});

describe('календарь и границы доступа', () => {
  it('список отправок за период с кратким содержанием; фильтр по каналу', async () => {
    const from = new Date(Date.now() - 24 * 3600_000).toISOString();
    const to = new Date(Date.now() + 48 * 3600_000).toISOString();
    const all = await api(
      'GET',
      `/publications?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBeGreaterThan(0);
    expect(all.body.items[0]).toHaveProperty('summary');
    const onlyB = await api(
      'GET',
      `/publications?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&channelId=${channelB}`,
    );
    expect(onlyB.body.items.every((i: Json) => i.channelId === channelB)).toBe(true);
  });

  it('чужой пост и чужая отправка недоступны', async () => {
    const { rows: u } = await db().query(
      "insert into users (telegram_id, role) values (777777, 'owner') returning id",
    );
    const { rows: p } = await db().query(
      'insert into posts (owner_id, content) values ($1, $2) returning id',
      [u[0].id, JSON.stringify(textContent('Чужой'))],
    );
    expect((await api('GET', `/posts/${p[0].id}`)).status).toBe(404);
    expect(
      (await api('PUT', `/posts/${p[0].id}`, { content: textContent('x'), version: 1 })).status,
    ).toBe(404);
    expect(
      (await api('POST', `/posts/${p[0].id}/publish`, { channelIds: [channelA], version: 1 }))
        .status,
    ).toBe(404);
    const { rows: pub } = await db().query(
      "insert into publications (owner_id, post_id, channel_id, status, scheduled_at) values ($1, $2, $3, 'scheduled', now() + interval '1 day') returning id",
      [u[0].id, p[0].id, channelA],
    );
    expect((await api('POST', `/publications/${pub[0].id}/cancel`)).status).toBe(404);
    await db().query('delete from users where id = $1', [u[0].id]);
  });
});
