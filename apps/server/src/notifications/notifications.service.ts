import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { NOTIFICATIONS_QUEUE } from '../queue/queue.module.js';

export type NotificationCategory = 'integration';

export interface OwnerNotification {
  category: NotificationCategory;
  text: string;
  /** Кнопка, открывающая раздел Mini App (путь относительно PUBLIC_URL). */
  openPath?: string;
  /**
   * Ключ схлопывания: повторное уведомление с тем же ключом в течение
   * DEDUPE_WINDOW_MS не отправляется (например, серия одинаковых изменений прав).
   */
  dedupeKey?: string;
}

export const DEDUPE_WINDOW_MS = 5 * 60_000;

/** Ставит уведомление владельцу в очередь; отправляет worker. */
@Injectable()
export class NotificationsService {
  constructor(@Inject(NOTIFICATIONS_QUEUE) private readonly queue: Queue) {}

  async notifyOwner(n: OwnerNotification): Promise<void> {
    const jobId = n.dedupeKey
      ? `notify-${n.dedupeKey}-${Math.floor(Date.now() / DEDUPE_WINDOW_MS)}`
      : undefined;
    await this.queue.add('owner', n, {
      ...(jobId ? { jobId } : {}),
      attempts: 8,
      backoff: { type: 'exponential', delay: 10_000 },
    });
  }
}
