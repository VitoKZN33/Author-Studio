import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { TELEGRAM_CLIENT } from '../telegram/telegram.module.js';
import type { TelegramClient } from '../telegram/telegram-client.js';
import { WEBHOOK_PATH } from './webhook.controller.js';

/** Типы обновлений, которые получает бот. Остальные Telegram не присылает. */
export const ALLOWED_UPDATES = [
  'message',
  'my_chat_member',
  'channel_post',
  'message_reaction_count',
] as const;

/** Паузы между повторами настройки: быстро при первом запуске, затем реже. */
export const SETUP_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000];

export const NETWORK_HINT =
  'Сервер не может подключиться к api.telegram.org. Задайте TELEGRAM_PROXY_URL (docs/DEPLOYMENT.md)';

/**
 * При старте worker: режим webhook — регистрирует webhook; режим polling — снимает его.
 * В обоих режимах — кнопка меню (открывает Mini App) и команды.
 * Ошибки не останавливают worker — повтор с нарастающей паузой.
 */
@Injectable()
export class TelegramSetupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramSetupService.name);
  private retryTimer?: NodeJS.Timeout;
  private attempt = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TELEGRAM_CLIENT) private readonly telegram: TelegramClient | null,
  ) {}

  onApplicationBootstrap(): void {
    const enabled = this.config.TELEGRAM_AUTO_SETUP ?? this.config.NODE_ENV === 'production';
    if (!this.telegram) {
      this.logger.warn(
        'Бот не настроен (TELEGRAM_BOT_TOKEN не задан) — функции Telegram отключены',
      );
      return;
    }
    if (!enabled) {
      this.logger.log('Регистрация бота отключена (TELEGRAM_AUTO_SETUP)');
      return;
    }
    void this.setup();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer);
  }

  webhookUrl(): string {
    return new URL(`/api/${WEBHOOK_PATH}`, this.config.PUBLIC_URL).toString();
  }

  async setup(): Promise<boolean> {
    const tg = this.telegram;
    if (!tg) return false;
    const mode = this.config.TELEGRAM_UPDATES_MODE;
    try {
      const me = await tg.call('getMe', (api) => api.getMe());
      if (mode === 'webhook') {
        await tg.call('setWebhook', (api) =>
          api.setWebhook(this.webhookUrl(), {
            secret_token: this.config.TELEGRAM_WEBHOOK_SECRET,
            allowed_updates: [...ALLOWED_UPDATES],
            drop_pending_updates: false,
            max_connections: 10,
          }),
        );
      } else {
        // getUpdates не работает, пока установлен webhook.
        await tg.call('deleteWebhook', (api) => api.deleteWebhook({ drop_pending_updates: false }));
      }
      await tg.call('setChatMenuButton', (api) =>
        api.setChatMenuButton({
          menu_button: {
            type: 'web_app',
            text: 'Открыть',
            web_app: { url: this.config.PUBLIC_URL },
          },
        }),
      );
      await tg.call('setMyCommands', (api) =>
        api.setMyCommands([{ command: 'start', description: `Открыть ${this.config.APP_NAME}` }]),
      );
      this.attempt = 0;
      this.logger.log(
        { bot: me.username, mode },
        'Бот настроен: обновления, меню и команды зарегистрированы',
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const delay =
        SETUP_RETRY_DELAYS_MS[Math.min(this.attempt, SETUP_RETRY_DELAYS_MS.length - 1)]!;
      this.attempt++;
      this.logger.error(
        { err: message, hint: /сеть недоступна|тайм-аут/.test(message) ? NETWORK_HINT : undefined },
        `Не удалось настроить бота, повтор через ${Math.round(delay / 1000)} с`,
      );
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => void this.setup(), delay);
      this.retryTimer.unref();
      return false;
    }
  }
}
