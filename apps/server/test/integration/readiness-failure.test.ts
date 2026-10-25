import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAppEnv } from './env.js';

// БД на закрытом порту: API должен стартовать, но сообщать о неготовности.
applyAppEnv({ DATABASE_URL: 'postgresql://app:pw@127.0.0.1:1/none' });
const { createApiApp } = await import('../../src/create-api-app.js');

let app: NestExpressApplication;
let base: string;

beforeAll(async () => {
  app = await createApiApp();
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(() => app.close());

describe('API при недоступной БД', () => {
  it('live → 200, ready → 503 без раскрытия адреса БД', async () => {
    expect((await fetch(`${base}/api/health/live`)).status).toBe(200);
    const res = await fetch(`${base}/api/health/ready`);
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(text).checks.database).toEqual({
      status: 'fail',
      message: 'База данных недоступна',
    });
    expect(text).not.toContain('127.0.0.1:1');
  });
});
