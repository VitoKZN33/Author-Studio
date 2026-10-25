/**
 * Проверка здоровья контейнера worker (HEALTHCHECK в compose):
 * код 0 — heartbeat в Redis свежий, 1 — нет.
 */
import { Redis } from 'ioredis';
import { WORKER_HEARTBEAT_KEY } from '../queue/queues.js';

const url = process.env.REDIS_URL;
if (!url) process.exit(1);
const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 3_000 });
redis.on('error', () => undefined);
try {
  await redis.connect();
  const beat = await redis.get(WORKER_HEARTBEAT_KEY);
  redis.disconnect();
  process.exit(beat ? 0 : 1);
} catch {
  redis.disconnect();
  process.exit(1);
}
