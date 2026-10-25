import type { INestApplicationContext } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAppEnv, telegramEnv } from './env.js';
import { BOT_ID, FakeTelegram, OWNER_ID, waitFor } from './fake-telegram.js';

/** Минимальный HTTP CONNECT-прокси: запоминает адреса туннелей. */
const tunnels: string[] = [];
const proxy: Server = createServer();
proxy.on('connect', (req, clientSocket, head) => {
  tunnels.push(req.url ?? '');
  const [host, port] = (req.url ?? '').split(':');
  const upstream = connect(Number(port), host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});
await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

const fake = new FakeTelegram();
await fake.start();
let served = false;
fake.on('getUpdates', () => {
  if (served) return [];
  served = true;
  return [
    {
      update_id: 9001,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: OWNER_ID, type: 'private', first_name: 'O' },
        from: { id: OWNER_ID, is_bot: false, first_name: 'O' },
        text: '/start',
      },
    },
  ];
});
fake.on('getMe', () => ({
  id: BOT_ID,
  is_bot: true,
  first_name: 'Studio',
  username: 'studio_bot',
}));

applyAppEnv({
  ...telegramEnv(fake.url),
  TELEGRAM_UPDATES_MODE: 'polling',
  TELEGRAM_AUTO_SETUP: 'true',
  TELEGRAM_PROXY_URL: proxyUrl,
});
const { NestFactory } = await import('@nestjs/core');
const { WorkerModule } = await import('../../src/worker/worker.module.js');
const { REDIS } = await import('../../src/redis/redis.module.js');
const { POLLING_OFFSET_KEY } = await import('../../src/bot/polling.service.js');

let worker: INestApplicationContext;

beforeAll(async () => {
  worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  await worker.get(REDIS).del(POLLING_OFFSET_KEY);
  await worker.init();
});

afterAll(async () => {
  await worker.close();
  await fake.stop();
  await new Promise<void>((r) => proxy.close(() => r()));
});

describe('режим polling через прокси', () => {
  it('настройка бота снимает webhook, а не устанавливает его', async () => {
    await waitFor(() => fake.callsOf('setMyCommands')[0]);
    expect(fake.callsOf('deleteWebhook')).not.toHaveLength(0);
    expect(fake.callsOf('setWebhook')).toHaveLength(0);
  });

  it('обновление из getUpdates обрабатывается: владельцу уходит приветствие', async () => {
    const msg = await waitFor(() => fake.callsOf('sendMessage')[0]);
    expect(String(msg.params.chat_id)).toBe(String(OWNER_ID));
  });

  it('смещение сохраняется в Redis и передаётся в следующий запрос', async () => {
    expect(await waitFor(async () => worker.get(REDIS).get(POLLING_OFFSET_KEY))).toBe('9002');
    await waitFor(() => fake.callsOf('getUpdates').find((c) => c.params.offset === 9002));
  });

  it('все запросы к Bot API идут через прокси', () => {
    const fakeHost = new URL(fake.url).host;
    expect(tunnels.length).toBeGreaterThan(0);
    expect(tunnels.every((t) => t === fakeHost)).toBe(true);
  });
});
