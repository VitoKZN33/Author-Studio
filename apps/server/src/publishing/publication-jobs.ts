import type { Queue } from 'bullmq';

export interface PublishJobData {
  publicationId: string;
}

/**
 * Идентификатор задания включает время отправки: при переносе публикации создаётся
 * новое задание, а старое при срабатывании увидит несовпадение времени и ничего не сделает.
 * Повторная постановка того же задания (тот же id) BullMQ отбрасывает.
 */
export function publishJobId(publicationId: string, scheduledAt: Date, suffix = ''): string {
  return `pub-${publicationId}-${scheduledAt.getTime()}${suffix ? `-${suffix}` : ''}`;
}

export async function enqueuePublish(
  queue: Queue,
  publicationId: string,
  scheduledAt: Date,
  opts: { delayMs?: number; suffix?: string } = {},
): Promise<void> {
  const delay = opts.delayMs ?? Math.max(0, scheduledAt.getTime() - Date.now());
  await queue.add('publish', { publicationId } satisfies PublishJobData, {
    jobId: publishJobId(publicationId, scheduledAt, opts.suffix),
    delay,
    // Повторы управляются исполнителем по состоянию в БД, а не BullMQ:
    // слепой повтор отправки мог бы создать дубль поста.
    attempts: 1,
  });
}

export const RECONCILE_JOB = 'reconcile';
