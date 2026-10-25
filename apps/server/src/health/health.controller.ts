import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @HttpCode(200)
  @ApiOperation({ summary: 'Процесс API запущен' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'API готов принимать запросы (БД и Redis доступны); 503 — нет' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.readiness();
    res.status(report.status === 'ok' ? 200 : 503);
    return report;
  }

  @Get('status')
  @ApiOperation({ summary: 'Сводное состояние, включая фоновый обработчик; 503 при сбое' })
  async status(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.status();
    res.status(report.status === 'ok' ? 200 : 503);
    return report;
  }
}
