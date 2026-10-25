import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { TELEGRAM_UPDATES_QUEUE } from '../queue/queue.module.js';
import { REDIS } from '../redis/redis.module.js';
import { TELEGRAM_CLIENT } from '../telegram/telegram.module.js';
import { TelegramApiError, type TelegramClient } from '../telegram/telegram-client.js';
import { ALLOWED_UPDATES, NETWORK_HINT } from './telegram-setup.service.js';

export const POLLING_OFFSET_KEY = 'author-studio:telegram:offset';
const LONG_POLL_SECONDS = 25;

/**
 * Режим polling: worker сам забирает обновления (getUpdates) и кладёт их в ту же
 * очередь, что и webhook. Смещение хранится в Redis — после перезапуска обновления
 * не теряются и не обрабатываются повторно (плюс дедупликация по update_id в очереди).
 */
@Injectable()
export class PollingService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PollingService.name);
  private abort?: AbortController;
  private loop?: Promise<void>;
  private networkFailing = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TELEGRAM_CLIENT) private readonly telegram: TelegramClient | null,
    @Inject(TELEGRAM_UPDATES_QUEUE) private readonly queue: Queue,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.telegram || this.config.TELEGRAM_UPDATES_MODE !== 'polling') return;
    this.abort = new AbortController();
    this.loop = this.run(this.telegram, this.abort.signal);
    this.logger.log('Получение обновлений Telegram: режим polling');
  }

  async onApplicationShutdown(): Promise<void> {
    this.abort?.abort();
    await this.loop?.catch(() => undefined);
  }

  private async sleep(ms: number, signal: AbortSignal) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  async pollOnce(tg: TelegramClient, signal?: AbortSignal): Promise<number> {
    const stored = await this.redis.get(POLLING_OFFSET_KEY);
    const offset = stored ? Number(stored) : undefined;
    const updates = await tg.call('getUpdates', (api) =>
      api.getUpdates(
        { offset, timeout: LONG_POLL_SECONDS, allowed_updates: [...ALLOWED_UPDATES] },
        // Тип AbortSignal grammY (полифил) не совпадает с встроенным, поведение одинаковое.
        signal as unknown as Parameters<typeof api.getUpdates>[1],
      ),
    );
    for (const update of updates) {
      await this.queue.add('update', update, {
        jobId: `update-${update.update_id}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
      });
      await this.redis.set(POLLING_OFFSET_KEY, String(update.update_id + 1));
    }
    return updates.length;
  }

  private async run(tg: TelegramClient, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.pollOnce(tg, signal);
        if (this.networkFailing) this.logger.log('Связь с Telegram восстановлена');
        this.networkFailing = false;
      } catch (err) {
        if (signal.aborted) return;
        let delay = 5_000;
        if (err instanceof TelegramApiError) {
          if (err.kind === 'rate_limited') delay = (err.retryAfter ?? 5) * 1000;
          if (err.code === 409) {
            // Установлен webhook или запущен второй экземпляр polling.
            this.logger.warn('Конфликт getUpdates (409): снимаю webhook');
            await tg.call('deleteWebhook', (api) => api.deleteWebhook()).catch(() => undefined);
          }
          if (err.kind === 'unauthorized') {
            this.logger.error('Telegram отклонил токен бота — получение обновлений остановлено');
            return;
          }
          if (err.kind === 'transient' && !this.networkFailing) {
            this.networkFailing = true;
            this.logger.error({ err: err.message, hint: NETWORK_HINT }, 'Нет связи с Telegram');
          }
        } else {
          this.logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'Ошибка получения обновлений',
          );
        }
        await this.sleep(delay, signal);
      }
    }
  }
}
