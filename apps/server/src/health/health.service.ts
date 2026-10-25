import { Inject, Injectable } from '@nestjs/common';
import {
  aggregateReadiness,
  type HealthCheckResult,
  type ReadinessReport,
} from '@author-studio/shared';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { PG_POOL } from '../database/database.module.js';
import { WORKER_HEARTBEAT_KEY } from '../queue/queues.js';
import { REDIS } from '../redis/redis.module.js';

const CHECK_TIMEOUT_MS = 3_000;

async function timed(check: () => Promise<void>, failMessage: string): Promise<HealthCheckResult> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return { status: 'ok', latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { status: 'fail', message: failMessage };
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  checkDatabase(): Promise<HealthCheckResult> {
    return timed(async () => {
      await this.pool.query('SELECT 1');
    }, 'База данных недоступна');
  }

  checkRedis(): Promise<HealthCheckResult> {
    return timed(async () => {
      const reply = await this.redis.ping();
      if (reply !== 'PONG') throw new Error('unexpected');
    }, 'Redis недоступен');
  }

  checkWorker(): Promise<HealthCheckResult> {
    return timed(async () => {
      const beat = await this.redis.get(WORKER_HEARTBEAT_KEY);
      if (!beat) throw new Error('no heartbeat');
    }, 'Фоновый обработчик не отвечает');
  }

  /** Готовность API принимать запросы: БД и Redis. */
  async readiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    return aggregateReadiness({ database, redis });
  }

  /** Сводное состояние установки, включая фоновый обработчик. */
  async status(): Promise<ReadinessReport> {
    const [database, redis, worker] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkWorker(),
    ]);
    return aggregateReadiness({ database, redis, worker });
  }
}
