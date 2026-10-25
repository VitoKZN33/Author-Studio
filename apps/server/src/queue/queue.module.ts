import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { createBullConnection, createQueue, QUEUE_NAMES } from './queues.js';

export const BULL_CONNECTION = Symbol('BULL_CONNECTION');
export const SYSTEM_QUEUE = Symbol('SYSTEM_QUEUE');
export const TELEGRAM_UPDATES_QUEUE = Symbol('TELEGRAM_UPDATES_QUEUE');
export const NOTIFICATIONS_QUEUE = Symbol('NOTIFICATIONS_QUEUE');
export const PUBLICATIONS_QUEUE = Symbol('PUBLICATIONS_QUEUE');
export const METRICS_QUEUE = Symbol('METRICS_QUEUE');
export const VIEWS_QUEUE = Symbol('VIEWS_QUEUE');

@Global()
@Module({
  providers: [
    {
      provide: BULL_CONNECTION,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createBullConnection(config.REDIS_URL),
    },
    {
      provide: SYSTEM_QUEUE,
      inject: [BULL_CONNECTION],
      useFactory: (conn: Redis) => createQueue(QUEUE_NAMES.system, conn),
    },
    {
      provide: TELEGRAM_UPDATES_QUEUE,
      inject: [BULL_CONNECTION],
      useFactory: (conn: Redis) => createQueue(QUEUE_NAMES.telegramUpdates, conn),
    },
    {
      provide: NOTIFICATIONS_QUEUE,
      inject: [BULL_CONNECTION],
      useFactory: (conn: Redis) => createQueue(QUEUE_NAMES.notifications, conn),
    },
    {
      provide: PUBLICATIONS_QUEUE,
      inject: [BULL_CONNECTION],
      useFactory: (conn: Redis) => createQueue(QUEUE_NAMES.publications, conn),
    },
    {
      provide: METRICS_QUEUE,
      inject: [BULL_CONNECTION],
      useFactory: (conn: Redis) => createQueue(QUEUE_NAMES.metrics, conn),
    },
    {
      provide: VIEWS_QUEUE,
      inject: [BULL_CONNECTION],
      useFactory: (conn: Redis) => createQueue(QUEUE_NAMES.views, conn),
    },
  ],
  exports: [
    BULL_CONNECTION,
    SYSTEM_QUEUE,
    TELEGRAM_UPDATES_QUEUE,
    NOTIFICATIONS_QUEUE,
    PUBLICATIONS_QUEUE,
    METRICS_QUEUE,
    VIEWS_QUEUE,
  ],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(SYSTEM_QUEUE) private readonly systemQueue: Queue,
    @Inject(TELEGRAM_UPDATES_QUEUE) private readonly updatesQueue: Queue,
    @Inject(NOTIFICATIONS_QUEUE) private readonly notificationsQueue: Queue,
    @Inject(PUBLICATIONS_QUEUE) private readonly publicationsQueue: Queue,
    @Inject(METRICS_QUEUE) private readonly metricsQueue: Queue,
    @Inject(VIEWS_QUEUE) private readonly viewsQueue: Queue,
    @Inject(BULL_CONNECTION) private readonly connection: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([
      this.systemQueue.close(),
      this.updatesQueue.close(),
      this.notificationsQueue.close(),
      this.publicationsQueue.close(),
      this.metricsQueue.close(),
      this.viewsQueue.close(),
    ]);
    this.connection.disconnect();
  }
}
