import { Body, Controller, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AiService } from './ai.service.js';
import { TEXT_ACTIONS, TONES } from './prompts.js';

const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    baseUrl: z
      .string()
      .trim()
      .max(500)
      .regex(/^https?:\/\/[^\s]+$/, {
        error: 'Адрес API должен начинаться с https:// или http://',
      }),
    model: z.string().trim().min(1, { error: 'Укажите модель' }).max(200),
    apiKey: z.string().max(500),
    useProxy: z.boolean(),
    styleGuide: z.string().max(3000),
    timeoutSeconds: z.number().int().min(10).max(300),
    maxOutputTokens: z.number().int().min(100).max(32_000),
    dailyRequestLimit: z.number().int().min(1).max(10_000),
    monthlyTokenLimit: nullableInt(1_000, 1_000_000_000),
    priceInputPerMillion: nullableInt(0, 100_000),
    priceOutputPerMillion: nullableInt(0, 100_000),
  })
  .partial()
  .strict();

const textSchema = z.object({
  action: z.enum(TEXT_ACTIONS),
  text: z.string().max(20_000).default(''),
  topic: z.string().max(3000).optional(),
  tone: z.enum(TONES).optional(),
  hasMedia: z.boolean().default(false),
});

const planSchema = z.object({
  topic: z.string().max(3000).default(''),
  days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
  postsPerWeek: z.number().int().min(1).max(21),
  channelId: z.uuid().optional(),
});

const draftsSchema = z.object({
  items: z
    .array(
      z.object({ title: z.string().trim().max(200), idea: z.string().trim().min(1).max(1500) }),
    )
    .min(1)
    .max(40),
});

const reviewSchema = z.object({
  channelId: z.uuid(),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});

/** Запросы к модели дорогие: отдельный, более строгий лимит частоты. */
const AI_THROTTLE = { default: { ttl: 60_000, limit: 20 } };

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Настройки AI (ключ — только маска)' })
  settings() {
    return this.ai.view();
  }

  @Put('settings')
  update(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>,
  ) {
    return this.ai.update(req.auth.userId, body);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Запросы сегодня и токены за месяц' })
  usage() {
    return this.ai.usage();
  }

  @Post('test')
  @HttpCode(200)
  @Throttle(AI_THROTTLE)
  @ApiOperation({ summary: 'Проверить подключение к провайдеру' })
  test(@Req() req: AuthenticatedRequest) {
    return this.ai.test(req.auth.userId);
  }

  @Post('text')
  @HttpCode(200)
  @Throttle(AI_THROTTLE)
  @ApiOperation({ summary: 'Написать, сократить, переписать, исправить текст поста' })
  text(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(textSchema)) body: z.infer<typeof textSchema>,
  ) {
    return this.ai.text(req.auth.userId, body);
  }

  @Post('plan')
  @HttpCode(200)
  @Throttle(AI_THROTTLE)
  @ApiOperation({ summary: 'Предложить контент-план (ничего не создаёт)' })
  plan(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(planSchema)) body: z.infer<typeof planSchema>,
  ) {
    return this.ai.plan(req.auth.userId, body);
  }

  @Post('plan/drafts')
  @ApiOperation({ summary: 'Создать черновики из выбранных пунктов плана' })
  drafts(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(draftsSchema)) body: z.infer<typeof draftsSchema>,
  ) {
    return this.ai.createDrafts(req.auth.userId, body.items);
  }

  @Post('analytics')
  @HttpCode(200)
  @Throttle(AI_THROTTLE)
  @ApiOperation({ summary: 'Разбор статистики канала: факты приложения + интерпретация AI' })
  review(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(reviewSchema)) body: z.infer<typeof reviewSchema>,
  ) {
    return this.ai.analyticsReview(req.auth.userId, body.channelId, body.days);
  }
}
