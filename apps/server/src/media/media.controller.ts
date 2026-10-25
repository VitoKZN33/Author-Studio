import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TELEGRAM_LIMITS } from '@author-studio/shared';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { diskStorage } from 'multer';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { loadConfig } from '../config/config.module.js';
import { MediaService } from './media.service.js';

@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Загрузить фото (до 10 МБ) или видео (до 50 МБ)' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, path.join(loadConfig().MEDIA_DIR, 'incoming')),
        // Имя генерирует сервер: пользовательское имя файла в путь не попадает.
        filename: (_req, _file, cb) => cb(null, `${randomUUID()}.upload`),
      }),
      limits: { fileSize: TELEGRAM_LIMITS.fileUploadMaxBytes, files: 1, fields: 5 },
    }),
  )
  async upload(@Req() req: AuthenticatedRequest, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не получен (поле file)');
    return this.media.accept(req.auth.userId, file.path, file.originalname, file.size);
  }

  @Get(':id/thumb')
  @ApiOperation({ summary: 'Миниатюра фото для списков (WebP); для видео — 404' })
  async thumb(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const row = await this.media.getOwned(req.auth.userId, id);
    const file = await this.media.thumbnail(row);
    if (!file) throw new NotFoundException('Миниатюры нет');
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(file), {
      type: 'image/webp',
      disposition: 'inline',
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить файл (для предпросмотра в приложении)' })
  async download(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const row = await this.media.getOwned(req.auth.userId, id);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(this.media.pathOf(row)), {
      type: row.mime,
      length: row.size,
      disposition: 'inline',
    });
  }
}
