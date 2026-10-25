import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AnalyticsService } from './analytics.service.js';

const daysSchema = z.coerce
  .number()
  .int()
  .refine((d) => [7, 30, 90].includes(d), 'допустимо 7, 30 или 90')
  .default(30);
const overviewQuery = z.object({ days: daysSchema });
const postsQuery = z.object({
  days: daysSchema,
  sort: z.enum(['date', 'reactions', 'views']).default('date'),
});
const bestQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d) => [30, 90].includes(d))
    .default(90),
  metric: z.enum(['reactions', 'views']).default('reactions'),
});
const manualBody = z
  .object({
    messageId: z.number().int().positive(),
    views: z.number().int().min(0).max(1_000_000_000).optional(),
    forwards: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .refine(
    (b) => b.views !== undefined || b.forwards !== undefined,
    'укажите просмотры или пересылки',
  );

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics/channels/:channelId')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Подписчики: текущее значение, ряд по дням, вступления/выходы, маркеры постов',
  })
  overview(
    @Req() req: AuthenticatedRequest,
    @Param('channelId', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(overviewQuery)) q: z.infer<typeof overviewQuery>,
  ) {
    return this.analytics.overview(req.auth.userId, id, q.days);
  }

  @Get('posts')
  @ApiOperation({ summary: 'Показатели постов за период' })
  async posts(
    @Req() req: AuthenticatedRequest,
    @Param('channelId', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(postsQuery)) q: z.infer<typeof postsQuery>,
  ) {
    return { items: await this.analytics.posts(req.auth.userId, id, q.days, q.sort) };
  }

  @Post('manual')
  @HttpCode(204)
  @ApiOperation({ summary: 'Ввести просмотры/пересылки поста вручную' })
  async manual(
    @Req() req: AuthenticatedRequest,
    @Param('channelId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(manualBody)) b: z.infer<typeof manualBody>,
  ): Promise<void> {
    await this.analytics.recordManual(req.auth.userId, id, b.messageId, {
      views: b.views,
      forwards: b.forwards,
    });
  }

  @Get('best-time')
  @ApiOperation({ summary: 'Сравнение публикаций по дню недели и времени' })
  bestTime(
    @Req() req: AuthenticatedRequest,
    @Param('channelId', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(bestQuery)) q: z.infer<typeof bestQuery>,
  ) {
    return this.analytics.bestTime(req.auth.userId, id, q.days, q.metric);
  }

  @Post('export')
  @HttpCode(204)
  @ApiOperation({ summary: 'Отправить CSV с показателями постов в чат с ботом' })
  async export(
    @Req() req: AuthenticatedRequest,
    @Param('channelId', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(overviewQuery)) q: z.infer<typeof overviewQuery>,
  ): Promise<void> {
    await this.analytics.sendCsvToOwner(req.auth.userId, id, q.days);
  }

  @Get('posts.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Экспорт показателей постов (CSV, разделитель «;»)' })
  async csv(
    @Req() req: AuthenticatedRequest,
    @Param('channelId', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(overviewQuery)) q: z.infer<typeof overviewQuery>,
  ) {
    const body = await this.analytics.csv(req.auth.userId, id, q.days);
    return new StreamableFile(Buffer.from(body, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="posts-${q.days}d.csv"`,
    });
  }
}
