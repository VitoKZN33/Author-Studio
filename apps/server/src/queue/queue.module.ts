import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { createBullConnection, createQueue, QUEUE_NAMES } from './queues.js';

export const BULL_CONNECTION = Symbol('BULL_CONNECTION');
export const SYSTEM_QUEUE = Symbol('SYSTEM_QUEUE');

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
  ],
  exports: [BULL_CONNECTION, SYSTEM_QUEUE],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(SYSTEM_QUEUE) private readonly systemQueue: Queue,
    @Inject(BULL_CONNECTION) private readonly connection: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.systemQueue.close();
    this.connection.disconnect();
  }
}
