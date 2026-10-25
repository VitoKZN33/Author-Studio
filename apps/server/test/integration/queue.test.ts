import { Job, Queue } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { createBullConnection, createWorker, processSystemJob } from '../../src/queue/queues.js';
import { testEnv } from './env.js';

// Отдельная очередь, чтобы тест не пересекался с рабочей очередью system.
const NAME = 'system' as const;
const prefix = `test-${Date.now()}`;
// Короткие интервалы проверки зависших заданий для всех воркеров файла: BullMQ
// хранит отметку последней проверки в Redis с TTL = stalledInterval воркера.
const FAST = { prefix, stalledInterval: 1_000, lockDuration: 1_000 };
const conn = createBullConnection(testEnv().redis);
const queue = new Queue(NAME, { connection: conn, prefix });

/** Ожидание завершения задания опросом состояния (не зависит от потока событий). */
async function waitForCompletion(id: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await Job.fromId(queue, id);
    const state = await job?.getState();
    if (state === 'completed') return job!;
    if (state === 'failed')
      throw new Error(`Задание ${id} завершилось ошибкой: ${job?.failedReason}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Задание ${id} не завершилось за ${timeoutMs} мс`);
}

afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
  conn.disconnect();
});

describe('очередь BullMQ', () => {
  it('отложенное задание, поставленное без воркера, выполняется после его запуска', async () => {
    const job = await queue.add('ping', { requestedAt: new Date().toISOString() }, { delay: 500 });
    // «Перезапуск»: воркер появляется только после постановки задания.
    await new Promise((r) => setTimeout(r, 800));
    const worker = createWorker(
      NAME,
      processSystemJob,
      createBullConnection(testEnv().redis),
      FAST,
    );
    const done = await waitForCompletion(job.id!, 10_000);
    expect(done.returnvalue).toMatchObject({ pong: true });
    await worker.close();
  });

  it('задание упавшего во время выполнения воркера подхватывает новый воркер', async () => {
    let firstStarted!: () => void;
    const started = new Promise<void>((r) => (firstStarted = r));
    const hangingConn = createBullConnection(testEnv().redis);
    const hanging = createWorker(
      NAME,
      async () => {
        firstStarted();
        await new Promise(() => undefined); // имитация зависания/падения процесса
      },
      hangingConn,
      FAST,
    );
    const job = await queue.add('ping', { requestedAt: new Date().toISOString() });
    await started;
    // Аварийная остановка процесса: соединение обрывается, блокировка не продлевается.
    void hanging.close(true).catch(() => undefined);
    hangingConn.disconnect();

    const recovered = createWorker(
      NAME,
      processSystemJob,
      createBullConnection(testEnv().redis),
      FAST,
    );
    const final = await waitForCompletion(job.id!, 15_000);
    expect(final.returnvalue).toMatchObject({ pong: true });
    expect(final.attemptsStarted).toBeGreaterThanOrEqual(2);
    await recovered.close();
  });

  it('один и тот же jobId не создаёт дубликат задания', async () => {
    const a = await queue.add(
      'ping',
      { requestedAt: 'x' },
      { jobId: 'publication-1', delay: 60_000 },
    );
    const b = await queue.add(
      'ping',
      { requestedAt: 'y' },
      { jobId: 'publication-1', delay: 60_000 },
    );
    expect(b.id).toBe(a.id);
    expect(await queue.getDelayedCount()).toBe(1);
    await a.remove();
  });
});
