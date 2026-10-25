import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Job, Queue, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { DB, type Database } from '../database/database.module.js';
import { channels } from '../database/schema.js';
import { BULL_CONNECTION, METRICS_QUEUE } from '../queue/queue.module.js';
import { createWorker, QUEUE_NAMES } from '../queue/queues.js';
import { TELEGRAM_CLIENT } from '../telegram/telegram.module.js';
import { TelegramApiError, type TelegramClient } from '../telegram/telegram-client.js';
import { AnalyticsIngestService } from './ingest.service.js';

export const COLLECT_ALL_JOB = 'collect-all';
export const COLLECT_CHANNEL_JOB = 'collect-channel';

/** Снимки числа подписчиков подключённых каналов по расписанию (getChatMemberCount). */
@Injectable()
export class MetricsCollector implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MetricsCollector.name);
  private worker?: Worker;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(BULL_CONNECTION) private readonly connection: Redis,
    @Inject(METRICS_QUEUE) private readonly queue: Queue,
    @Inject(TELEGRAM_CLIENT) private readonly telegram: TelegramClient | null,
    private readonly ingest: AnalyticsIngestService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.telegram) return;
    this.worker = createWorker(
      QUEUE_NAMES.metrics,
      (job: Job) => this.process(job),
      this.connection,
    );
    await this.queue
      .upsertJobScheduler(
        'subscribers-schedule',
        { every: this.config.METRICS_SUBSCRIBERS_INTERVAL_MINUTES * 60_000 },
        { name: COLLECT_ALL_JOB },
      )
      .catch((err: Error) =>
        this.logger.error({ err: err.message }, 'Не удалось запустить сбор метрик'),
      );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Job): Promise<number> {
    if (job.name === COLLECT_CHANNEL_JOB) {
      return (await this.collectChannel((job.data as { channelId: string }).channelId)) ? 1 : 0;
    }
    return this.collectAll();
  }

  async collectAll(): Promise<number> {
    const list = await this.db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.status, 'active'));
    let ok = 0;
    for (const c of list) {
      if (await this.collectChannel(c.id)) ok++;
      await new Promise((r) => setTimeout(r, 200)); // бережём лимиты Bot API
    }
    return ok;
  }

  async collectChannel(channelId: string): Promise<boolean> {
    if (!this.telegram) return false;
    const [c] = await this.db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
    if (!c || c.status === 'detected' || c.status === 'disconnected') return false;
    try {
      const count = await this.telegram.call('getChatMemberCount', (api) =>
        api.getChatMemberCount(Number(c.tgChatId)),
      );
      await this.ingest.recordSubscribers(c.id, count);
      return true;
    } catch (err) {
      // Пропуск измерения не заполняется нулём: на графике будет «нет данных».
      const msg = err instanceof TelegramApiError ? err.message : String(err);
      this.logger.warn({ channelId, err: msg }, 'Число подписчиков не получено');
      return false;
    }
  }
}
