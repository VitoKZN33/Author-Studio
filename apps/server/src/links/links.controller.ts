import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { Public } from '../auth/public.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LinksService } from './links.service.js';

const createSchema = z.object({
  title: z.string().trim().min(1, { error: 'Назовите ссылку' }).max(120),
  targetUrl: z.string().trim().min(8).max(2048),
  channelId: z.uuid().nullable().optional(),
  isAd: z.boolean().optional(),
  postId: z.uuid().nullable().optional(),
});

@ApiTags('links')
@ApiBearerAuth()
@Controller('links')
export class LinksController {
  constructor(private readonly links: LinksService) {}

  @Get()
  @ApiOperation({ summary: 'Отслеживаемые ссылки с переходами (всего и за период)' })
  async list(@Req() req: AuthenticatedRequest, @Query('days') days?: string) {
    const d = Math.min(365, Math.max(1, Number(days) || 30));
    return { items: await this.links.list(req.auth.userId, new Date(Date.now() - d * 86_400_000)) };
  }

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.links.create(req.auth.userId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.links.archive(req.auth.userId, id);
  }
}

/** Публичный переход по короткой ссылке: /r/<slug> (Caddy передаёт как /api/r/<slug>). */
@Controller('r')
export class RedirectController {
  constructor(private readonly links: LinksService) {}

  @Get(':slug')
  @Public()
  @ApiExcludeEndpoint()
  async go(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
    const target = await this.links.resolve(slug, req.ip ?? '', req.get('user-agent'));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!target) {
      res.status(404).type('text/plain; charset=utf-8').send('Ссылка не найдена или отключена.');
      return;
    }
    res.redirect(302, target);
  }
}
