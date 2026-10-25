import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { loadConfig } from '../config/config.module.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { MAX_INIT_DATA_LENGTH } from './init-data.js';
import { Public } from './public.decorator.js';

const loginSchema = z.object({
  initData: z
    .string()
    .min(1, 'обязательное поле')
    .max(MAX_INIT_DATA_LENGTH, 'слишком длинное значение'),
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('telegram')
  @HttpCode(200)
  @Throttle({ default: { limit: () => loadConfig().AUTH_LOGIN_RATE_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Вход по initData Telegram Mini App' })
  async login(@Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    const r = await this.auth.loginWithInitData(body.initData);
    return {
      token: r.token,
      expiresAt: r.expiresAt.toISOString(),
      user: r.user,
      startParam: r.startParam ?? null,
    };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Текущий пользователь' })
  me(@Req() req: AuthenticatedRequest) {
    return {
      user: { id: req.auth.userId, telegramId: String(req.auth.telegramId), role: req.auth.role },
    };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Завершить текущую сессию' })
  async logout(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.auth.logout(req.auth);
  }
}
