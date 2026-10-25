import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
} from '../queue/queues.js';
import { REDIS } from '../redis/redis.module.js';

/** Периодически отмечает в Redis, что фоновый обработчик жив. */
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HeartbeatService.name);
  private timer?: NodeJS.Timeout;
  private failing = false;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onApplicationBootstrap(): void {
    void this.beat();
    this.timer = setInterval(() => void this.beat(), WORKER_HEARTBEAT_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.redis.del(WORKER_HEARTBEAT_KEY).catch(() => undefined);
  }

  async beat(): Promise<void> {
    try {
      await this.redis.set(
        WORKER_HEARTBEAT_KEY,
        new Date().toISOString(),
        'EX',
        WORKER_HEARTBEAT_TTL_SECONDS,
      );
      if (this.failing) this.logger.log('Связь с Redis восстановлена');
      this.failing = false;
    } catch {
      if (!this.failing) this.logger.warn('Не удалось записать heartbeat в Redis');
      this.failing = true;
    }
  }
}
