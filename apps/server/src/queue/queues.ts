import { Queue, Worker, type Processor, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';

/** Имена очередей. Новые очереди (публикации, метрики…) добавляются на своих этапах. */
export const QUEUE_NAMES = {
  system: 'system',
  /** Обновления Telegram из webhook: API кладёт, worker обрабатывает. */
  telegramUpdates: 'telegram-updates',
  /** Исходящие уведомления владельцу через бота. */
  notifications: 'notifications',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Ключ heartbeat воркера и его срок жизни. */
export const WORKER_HEARTBEAT_KEY = 'author-studio:worker:heartbeat';
export const WORKER_HEARTBEAT_TTL_SECONDS = 30;
export const WORKER_HEARTBEAT_INTERVAL_MS = 10_000;

/** BullMQ требует maxRetriesPerRequest: null для блокирующих команд воркера. */
export function createBullConnection(url: string): Redis {
  const conn = new Redis(url, { maxRetriesPerRequest: null, connectTimeout: 5_000 });
  conn.on('error', () => undefined);
  return conn;
}

export function createQueue(name: QueueName, connection: Redis): Queue {
  return new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      // История выполненных заданий ограничена, ошибки храним дольше для разбора.
      removeOnComplete: { count: 1_000, age: 7 * 24 * 3600 },
      removeOnFail: { count: 5_000, age: 30 * 24 * 3600 },
    },
  });
}

export function createWorker<T = unknown, R = unknown>(
  name: QueueName,
  processor: Processor<T, R>,
  connection: Redis,
  options: Partial<WorkerOptions> = {},
): Worker<T, R> {
  return new Worker<T, R>(name, processor, {
    connection,
    concurrency: 1,
    // Задание, чей воркер упал, считается зависшим и возвращается в очередь.
    stalledInterval: 30_000,
    maxStalledCount: 1,
    ...options,
  });
}

export interface SystemPingJob {
  requestedAt: string;
}

/** Служебное задание для проверки связки API → очередь → воркер. */
export async function processSystemJob(job: { name: string; data: unknown }) {
  if (job.name === 'ping') {
    const data = job.data as SystemPingJob;
    return { pong: true, requestedAt: data.requestedAt, processedAt: new Date().toISOString() };
  }
  throw new Error(`Неизвестный тип системного задания: ${job.name}`);
}
