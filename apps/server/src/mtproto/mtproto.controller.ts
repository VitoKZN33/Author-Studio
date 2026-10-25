import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MtprotoService } from './mtproto.service.js';

const startSchema = z.object({
  apiId: z.coerce.number().int().min(1).max(2_147_483_647),
  apiHash: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{32}$/i, { error: 'api_hash — 32 символа (0–9, a–f)' }),
  phone: z.string().trim().min(10).max(20),
});
const codeSchema = z.object({ loginId: z.uuid(), code: z.string().trim().min(4).max(10) });
const passwordSchema = z.object({ loginId: z.uuid(), password: z.string().min(1).max(256) });
const cancelSchema = z.object({ loginId: z.uuid() });

/** Попытки входа ограничены строже: ошибки кода Telegram считает и может заблокировать вход. */
const LOGIN_THROTTLE = { default: { ttl: 60_000, limit: 8 } };

@ApiTags('views')
@ApiBearerAuth()
@Controller('mtproto')
export class MtprotoController {
  constructor(private readonly mtproto: MtprotoService) {}

  @Get()
  @ApiOperation({ summary: 'Состояние подключения аккаунта для просмотров' })
  status() {
    return this.mtproto.view();
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(LOGIN_THROTTLE)
  @ApiOperation({ summary: 'Отправить код входа на номер владельца' })
  start(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>,
  ) {
    return this.mtproto.startLogin(req.auth.userId, body);
  }

  @Post('login/code')
  @HttpCode(200)
  @Throttle(LOGIN_THROTTLE)
  code(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(codeSchema)) body: z.infer<typeof codeSchema>,
  ) {
    return this.mtproto.submitCode(req.auth.userId, body.loginId, body.code);
  }

  @Post('login/password')
  @HttpCode(200)
  @Throttle(LOGIN_THROTTLE)
  password(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(passwordSchema)) body: z.infer<typeof passwordSchema>,
  ) {
    return this.mtproto.submitPassword(req.auth.userId, body.loginId, body.password);
  }

  @Post('login/cancel')
  @HttpCode(204)
  async cancel(@Body(new ZodValidationPipe(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    await this.mtproto.cancel(body.loginId);
  }

  @Post('sync')
  @HttpCode(202)
  @ApiOperation({ summary: 'Забрать просмотры сейчас' })
  async sync() {
    await this.mtproto.syncNow();
    return { queued: true };
  }

  @Delete()
  @ApiOperation({ summary: 'Отключить аккаунт: завершить сеанс в Telegram и удалить данные' })
  disconnect(@Req() req: AuthenticatedRequest) {
    return this.mtproto.disconnect(req.auth.userId);
  }
}
