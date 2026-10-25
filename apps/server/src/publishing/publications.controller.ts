import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PublishingService } from './publishing.service.js';

const publishSchema = z.object({
  channelIds: z
    .array(z.uuid('неверный идентификатор канала'))
    .min(1, 'выберите хотя бы один канал')
    .max(20),
  scheduledAt: z.iso
    .datetime({ offset: true, error: 'ожидается время ISO 8601' })
    .nullable()
    .optional(),
  version: z.number().int().min(1),
});
const rescheduleSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true, error: 'ожидается время ISO 8601' }),
});
const resolveSchema = z.object({ outcome: z.enum(['published', 'resend']) });
const STATUSES = ['scheduled', 'sending', 'published', 'failed', 'ambiguous', 'cancelled'] as const;
const listSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  channelId: z.uuid().optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(z.enum(STATUSES)).optional()),
});

@ApiTags('publications')
@ApiBearerAuth()
@Controller()
export class PublicationsController {
  constructor(private readonly publishing: PublishingService) {}

  @Post('posts/:id/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Опубликовать сейчас или запланировать в выбранные каналы' })
  publish(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(publishSchema)) body: z.infer<typeof publishSchema>,
  ) {
    return this.publishing.publish(req.auth.userId, id, body).then((items) => ({ items }));
  }

  @Get('publications')
  @ApiOperation({ summary: 'Отправки за период (календарь)' })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>,
  ) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to.getTime() - from.getTime() > 100 * 24 * 3600_000) {
      return { items: [], error: 'Период не больше 100 дней' };
    }
    return {
      items: await this.publishing.list(req.auth.userId, {
        from,
        to,
        channelId: q.channelId,
        status: q.status,
      }),
    };
  }

  @Post('publications/:id/reschedule')
  @HttpCode(200)
  reschedule(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rescheduleSchema)) body: z.infer<typeof rescheduleSchema>,
  ) {
    return this.publishing.reschedule(req.auth.userId, id, body.scheduledAt);
  }

  @Post('publications/:id/cancel')
  @HttpCode(200)
  cancel(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.publishing.cancel(req.auth.userId, id);
  }

  @Post('publications/:id/retry')
  @HttpCode(200)
  retry(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.publishing.retry(req.auth.userId, id);
  }

  @Post('publications/:id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отметить результат отправки с неизвестным исходом' })
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>,
  ) {
    return this.publishing.resolve(req.auth.userId, id, body.outcome);
  }
}
