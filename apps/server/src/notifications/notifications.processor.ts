import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { BULL_CONNECTION } from '../queue/queue.module.js';
import { createWorker, QUEUE_NAMES } from '../queue/queues.js';
import { TELEGRAM_CLIENT } from '../telegram/telegram.module.js';
import { TelegramApiError, type TelegramClient } from '../telegram/telegram-client.js';
import type { OwnerNotification } from './notifications.service.js';

/** Отправляет уведомления владельцу через бота с учётом лимитов Telegram. */
@Injectable()
export class NotificationsProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private worker?: Worker<OwnerNotification>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BULL_CONNECTION) private readonly connection: Redis,
    @Inject(TELEGRAM_CLIENT) private readonly telegram: TelegramClient | null,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = createWorker<OwnerNotification>(
      QUEUE_NAMES.notifications,
      (job) => this.process(job),
      this.connection,
      // Не больше 1 сообщения в секунду в один чат (ориентир Telegram).
      { limiter: { max: 1, duration: 1_000 } },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn({ jobId: job?.id, err: err.message }, 'Уведомление не отправлено'),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Job<OwnerNotification>): Promise<void> {
    const ownerId = this.config.OWNER_TELEGRAM_ID;
    if (!this.telegram || !ownerId) {
      throw new UnrecoverableError('Бот не настроен — уведомление не может быть отправлено');
    }
    const n = job.data;
    const url = n.openPath ? new URL(n.openPath, this.config.PUBLIC_URL).toString() : undefined;
    try {
      await this.telegram.call('sendMessage', (api) =>
        api.sendMessage(ownerId, n.text, {
          link_preview_options: { is_disabled: true },
          ...(url
            ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть', web_app: { url } }]] } }
            : {}),
        }),
      );
    } catch (err) {
      if (err instanceof TelegramApiError) {
        if (err.kind === 'rate_limited') {
          // Пауза всей очереди на retry_after; задание вернётся в ожидание без траты попытки.
          await this.worker?.rateLimit((err.retryAfter ?? 5) * 1000);
          throw Worker.RateLimitError();
        }
        if (err.kind === 'permanent' || err.kind === 'unauthorized') {
          // Например, владелец ещё не открыл бота (403) — повторы бессмысленны.
          throw new UnrecoverableError(err.message);
        }
      }
      throw err;
    }
  }
}
