import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
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

/**
 * При старте worker: регистрирует webhook, кнопку меню (открывает Mini App) и команды.
 * Ошибки не останавливают worker — повтор через 5 минут.
 */
@Injectable()
export class TelegramSetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TelegramSetupService.name);
  private retryTimer?: NodeJS.Timeout;

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
      this.logger.log('Регистрация webhook отключена (TELEGRAM_AUTO_SETUP)');
      return;
    }
    void this.setup();
  }

  webhookUrl(): string {
    return new URL(`/api/${WEBHOOK_PATH}`, this.config.PUBLIC_URL).toString();
  }

  async setup(): Promise<boolean> {
    const tg = this.telegram;
    if (!tg) return false;
    try {
      const me = await tg.call('getMe', (api) => api.getMe());
      await tg.call('setWebhook', (api) =>
        api.setWebhook(this.webhookUrl(), {
          secret_token: this.config.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: [...ALLOWED_UPDATES],
          drop_pending_updates: false,
          max_connections: 10,
        }),
      );
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
      this.logger.log(
        { bot: me.username },
        'Бот настроен: webhook, меню и команды зарегистрированы',
      );
      return true;
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Не удалось настроить бота, повтор через 5 минут',
      );
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => void this.setup(), 5 * 60_000);
      this.retryTimer.unref();
      return false;
    }
  }
}
