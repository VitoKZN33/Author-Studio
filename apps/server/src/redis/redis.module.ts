import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';

export const REDIS = Symbol('REDIS');

/**
 * Общий клиент Redis для служебных операций (heartbeat, проверки, кэш).
 * Без офлайн-очереди: при недоступном Redis команды падают сразу, а не копятся.
 * Очереди BullMQ создают собственные соединения (см. queue/queues.ts).
 */
export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    lazyConnect: true,
  });
}

/**
 * Подключается, ожидая готовности не дольше timeoutMs. Если Redis недоступен,
 * сервис всё равно стартует: ioredis продолжит переподключаться, а проблема
 * будет видна в /api/health/ready.
 */
export async function connectRedis(client: Redis, timeoutMs = 5_000): Promise<Redis> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    client.connect().catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig) => {
        const client = createRedisClient(config.REDIS_URL);
        // Ошибки соединения отражаются в health-проверках; без обработчика ioredis
        // выводит необработанные события в stderr.
        client.on('error', () => undefined);
        return connectRedis(client);
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
  }
}
