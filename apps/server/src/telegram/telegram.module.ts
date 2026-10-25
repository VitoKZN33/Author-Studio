import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { TelegramClient } from './telegram-client.js';

export const TELEGRAM_CLIENT = Symbol('TELEGRAM_CLIENT');

/** Клиент Bot API или null, если бот ещё не настроен в .env. */
@Global()
@Module({
  providers: [
    {
      provide: TELEGRAM_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): TelegramClient | null =>
        config.TELEGRAM_BOT_TOKEN
          ? new TelegramClient(config.TELEGRAM_BOT_TOKEN, {
              apiRoot: config.TELEGRAM_API_ROOT,
              proxyUrl: config.TELEGRAM_PROXY_URL,
            })
          : null,
    },
  ],
  exports: [TELEGRAM_CLIENT],
})
export class TelegramModule {}
