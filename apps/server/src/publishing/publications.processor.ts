import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Job, Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { BULL_CONNECTION, PUBLICATIONS_QUEUE } from '../queue/queue.module.js';
import { createWorker, QUEUE_NAMES } from '../queue/queues.js';
import { PublicationExecutor } from './publication-executor.service.js';
import { RECONCILE_JOB, type PublishJobData } from './publication-jobs.js';

export const RECONCILE_EVERY_MS = 60_000;

@Injectable()
export class PublicationsProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PublicationsProcessor.name);
  private worker?: Worker;

  constructor(
    @Inject(BULL_CONNECTION) private readonly connection: Redis,
    @Inject(PUBLICATIONS_QUEUE) private readonly queue: Queue,
    private readonly executor: PublicationExecutor,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.worker = createWorker(
      QUEUE_NAMES.publications,
      (job: Job) => this.process(job),
      this.connection,
      {
        // Разные каналы обрабатываются параллельно; одну отправку защищает блокировка строки.
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        { jobId: job?.id, err: err.message },
        'Задание публикации завершилось ошибкой',
      ),
    );
    // Планировщик BullMQ: одно задание реконсиляции в минуту на всю установку.
    await this.queue
      .upsertJobScheduler(
        'reconcile-schedule',
        { every: RECONCILE_EVERY_MS },
        { name: RECONCILE_JOB },
      )
      .catch((err: Error) =>
        this.logger.error({ err: err.message }, 'Не удалось запустить реконсилятор'),
      );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === RECONCILE_JOB) return this.executor.reconcile();
    return this.executor.execute((job.data as PublishJobData).publicationId);
  }
}
