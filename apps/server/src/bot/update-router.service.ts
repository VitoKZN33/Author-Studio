import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Update } from 'grammy/types';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { ChannelsService } from '../channels/channels.service.js';
import { TELEGRAM_CLIENT } from '../telegram/telegram.module.js';
import type { TelegramClient } from '../telegram/telegram-client.js';

export const OWNER_WELCOME =
  'Здравствуйте! Это ваша установка Author Studio.\n\n' +
  'Чтобы подключить канал: добавьте этого бота в канал администратором с правами ' +
  'на публикацию, редактирование и удаление сообщений, затем откройте приложение.';

export const STRANGER_REPLY =
  'Это частный бот установки Author Studio. Доступ к нему есть только у владельца.';

/** Маршрутизация обновлений Telegram (выполняется в worker). */
@Injectable()
export class UpdateRouter {
  private readonly logger = new Logger(UpdateRouter.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TELEGRAM_CLIENT) private readonly telegram: TelegramClient | null,
    private readonly channels: ChannelsService,
  ) {}

  async handle(update: Update): Promise<void> {
    if (update.my_chat_member) {
      await this.channels.onBotMembershipChanged(update.my_chat_member);
      return;
    }
    const msg = update.message;
    if (msg?.chat.type === 'private' && msg.text && /^\/start(\s|$|@)/.test(msg.text)) {
      await this.onStart(msg.chat.id, msg.from?.id);
      return;
    }
    this.logger.debug({ updateId: update.update_id }, 'Обновление без обработчика');
  }

  private async onStart(chatId: number, fromId: number | undefined): Promise<void> {
    if (!this.telegram) return;
    const isOwner = fromId !== undefined && String(fromId) === this.config.OWNER_TELEGRAM_ID;
    if (!isOwner) {
      await this.telegram.call('sendMessage', (api) => api.sendMessage(chatId, STRANGER_REPLY));
      return;
    }
    await this.telegram.call('sendMessage', (api) =>
      api.sendMessage(chatId, OWNER_WELCOME, {
        reply_markup: {
          inline_keyboard: [
            [{ text: `Открыть ${this.config.APP_NAME}`, web_app: { url: this.config.PUBLIC_URL } }],
          ],
        },
      }),
    );
  }
}
