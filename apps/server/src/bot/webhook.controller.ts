import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Queue } from 'bullmq';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/public.decorator.js';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { TELEGRAM_UPDATES_QUEUE } from '../queue/queue.module.js';

export const WEBHOOK_PATH = 'telegram/webhook';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Приём обновлений Telegram. Проверяется секрет из setWebhook(secret_token),
 * обновление ставится в очередь и сразу подтверждается — обработка в worker.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller()
export class WebhookController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TELEGRAM_UPDATES_QUEUE) private readonly queue: Queue,
  ) {}

  @Post(WEBHOOK_PATH)
  @HttpCode(200)
  async receive(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: unknown,
  ): Promise<Record<string, never>> {
    const expected = this.config.TELEGRAM_WEBHOOK_SECRET;
    if (!this.config.TELEGRAM_BOT_TOKEN || !expected) throw new NotFoundException();
    if (!secret || !safeEqual(secret, expected)) throw new UnauthorizedException();

    const updateId = (update as { update_id?: unknown } | null)?.update_id;
    if (!Number.isSafeInteger(updateId)) return {};
    // jobId = update_id: повторная доставка того же обновления не создаёт второе задание.
    await this.queue.add('update', update, {
      jobId: `update-${updateId as number}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
    });
    return {};
  }
}
