import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAppEnv } from './env.js';

applyAppEnv();
const { createApiApp } = await import('../../src/create-api-app.js');
const { NestFactory } = await import('@nestjs/core');
const { WorkerModule } = await import('../../src/worker/worker.module.js');
const { REDIS } = await import('../../src/redis/redis.module.js');
const { WORKER_HEARTBEAT_KEY } = await import('../../src/queue/queues.js');
const { AuditService } = await import('../../src/audit/audit.service.js');
const { PG_POOL } = await import('../../src/database/database.module.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const json = (r: Response): Promise<Json> => r.json();

let app: NestExpressApplication;
let base: string;

beforeAll(async () => {
  app = await createApiApp();
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  await app.get(REDIS).del(WORKER_HEARTBEAT_KEY);
});

afterAll(async () => {
  await app.close();
});

describe('API: проверки здоровья', () => {
  it('live → 200', async () => {
    const res = await fetch(`${base}/api/health/live`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ status: 'ok' });
  });

  it('ready → 200, когда БД и Redis доступны', async () => {
    const res = await fetch(`${base}/api/health/ready`);
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.redis.status).toBe('ok');
  });

  it('status → 503 без воркера и 200 после его запуска', async () => {
    const before = await fetch(`${base}/api/health/status`);
    expect(before.status).toBe(503);
    expect((await json(before)).checks.worker.message).toBe('Фоновый обработчик не отвечает');

    let worker: INestApplicationContext | undefined;
    try {
      worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
      await worker.init();
      await new Promise((r) => setTimeout(r, 300));
      const after = await fetch(`${base}/api/health/status`);
      expect(after.status).toBe(200);
    } finally {
      await worker?.close();
    }
    // Корректная остановка воркера снимает heartbeat.
    expect(await app.get(REDIS).get(WORKER_HEARTBEAT_KEY)).toBeNull();
  });
});

describe('API: формат ошибок и ограничения', () => {
  it('неизвестный маршрут → 404 на русском с идентификатором запроса', async () => {
    const res = await fetch(`${base}/api/does-not-exist`);
    const body = await json(res);
    expect(res.status).toBe(404);
    expect(body.error.message).toBe('Не найдено');
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toMatch(/stack|at .*\.js/);
  });

  it('тело больше 1 МБ → 413', async () => {
    const res = await fetch(`${base}/api/health/live`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 'a'.repeat(1_100_000) }),
    });
    expect(res.status).toBe(413);
    expect((await json(res)).error.message).toBe('Слишком большой запрос');
  });

  it('защитные заголовки установлены, x-powered-by отсутствует', async () => {
    const res = await fetch(`${base}/api/health/live`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});

describe('журнал событий', () => {
  it('записывает событие и отбрасывает секретные поля metadata', async () => {
    await app.get(AuditService).record({
      action: 'test.event',
      entityType: 'test',
      entityId: '1',
      metadata: { ok: true, botToken: 'never' },
    });
    const { rows } = await app
      .get(PG_POOL)
      .query("select metadata from audit_log where action = 'test.event'");
    expect(rows).toEqual([{ metadata: { ok: true } }]);
  });
});
