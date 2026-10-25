import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ChannelsService } from './channels.service.js';

const connectSchema = z.object({
  chat: z.string().trim().min(1, 'укажите канал').max(256, 'слишком длинное значение'),
});

@ApiTags('channels')
@ApiBearerAuth()
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @ApiOperation({ summary: 'Каналы владельца (подключённые и обнаруженные)' })
  async list(@Req() req: AuthenticatedRequest) {
    return { items: await this.channels.list(req.auth.userId) };
  }

  @Post('connect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Подключить канал по @username, ссылке t.me или ID' })
  connect(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(connectSchema)) body: z.infer<typeof connectSchema>,
  ) {
    return this.channels.connect(req.auth.userId, req.auth.telegramId, body.chat);
  }

  @Post(':id/connect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Подключить обнаруженный или отключённый канал' })
  connectDetected(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.channels.connectDetected(req.auth.userId, req.auth.telegramId, id);
  }

  @Post(':id/check')
  @HttpCode(200)
  @ApiOperation({ summary: 'Повторно проверить права бота' })
  check(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.channels.recheck(req.auth.userId, id);
  }

  @Post(':id/disconnect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отключить канал в приложении (бот остаётся в канале)' })
  disconnect(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.channels.disconnect(req.auth.userId, id);
  }
}
