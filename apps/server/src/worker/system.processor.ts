import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { BULL_CONNECTION } from '../queue/queue.module.js';
import { createWorker, processSystemJob, QUEUE_NAMES } from '../queue/queues.js';

@Injectable()
export class SystemProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SystemProcessor.name);
  private worker?: Worker;

  constructor(@Inject(BULL_CONNECTION) private readonly connection: Redis) {}

  onApplicationBootstrap(): void {
    this.worker = createWorker(QUEUE_NAMES.system, processSystemJob, this.connection);
    this.worker.on('failed', (job, err) =>
      this.logger.warn(
        { jobId: job?.id, jobName: job?.name, err: err.message },
        'Задание не выполнено',
      ),
    );
    this.worker.on('error', (err) =>
      this.logger.error({ err: err.message }, 'Ошибка обработчика очереди'),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    // close() дожидается завершения текущего задания.
    await this.worker?.close();
  }
}
