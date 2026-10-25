import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Update } from 'grammy/types';
import type { Redis } from 'ioredis';
import { BULL_CONNECTION } from '../queue/queue.module.js';
import { createWorker, QUEUE_NAMES } from '../queue/queues.js';
import { TelegramApiError } from '../telegram/telegram-client.js';
import { UpdateRouter } from './update-router.service.js';

@Injectable()
export class UpdatesProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(UpdatesProcessor.name);
  private worker?: Worker<Update>;

  constructor(
    @Inject(BULL_CONNECTION) private readonly connection: Redis,
    private readonly router: UpdateRouter,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = createWorker<Update>(
      QUEUE_NAMES.telegramUpdates,
      (job) => this.process(job),
      this.connection,
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn({ jobId: job?.id, err: err.message }, 'Обновление Telegram не обработано'),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Job<Update>): Promise<void> {
    try {
      await this.router.handle(job.data);
    } catch (err) {
      if (err instanceof TelegramApiError) {
        if (err.kind === 'rate_limited') {
          await this.worker?.rateLimit((err.retryAfter ?? 5) * 1000);
          throw Worker.RateLimitError();
        }
        if (err.kind === 'permanent') throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  }
}
