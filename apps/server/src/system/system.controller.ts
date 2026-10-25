import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { TELEGRAM_CLIENT } from '../telegram/telegram.module.js';
import type { TelegramClient } from '../telegram/telegram-client.js';

const BOT_INFO_TTL_MS = 60 * 60_000;

/** Сведения об установке для интерфейса (название, бот, часовой пояс). */
@ApiTags('system')
@ApiBearerAuth()
@Controller('system')
export class SystemController {
  private readonly logger = new Logger(SystemController.name);
  private botUsername: { value: string | null; at: number } | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TELEGRAM_CLIENT) private readonly telegram: TelegramClient | null,
  ) {}

  private async getBotUsername(): Promise<string | null> {
    if (!this.telegram) return null;
    if (this.botUsername && Date.now() - this.botUsername.at < BOT_INFO_TTL_MS) {
      return this.botUsername.value;
    }
    try {
      const me = await this.telegram.call('getMe', (api) => api.getMe());
      this.botUsername = { value: me.username, at: Date.now() };
      return me.username;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'getMe не удался',
      );
      return this.botUsername?.value ?? null;
    }
  }

  @Get('info')
  @ApiOperation({ summary: 'Название установки, имя бота, часовой пояс' })
  async info() {
    return {
      appName: this.config.APP_NAME,
      timezone: this.config.APP_TIMEZONE,
      botUsername: await this.getBotUsername(),
      version: '0.1.0',
    };
  }
}
