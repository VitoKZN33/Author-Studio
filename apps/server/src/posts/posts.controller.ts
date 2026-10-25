import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EMPTY_POST_CONTENT, postContentSchema } from '@author-studio/shared';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PostsService } from './posts.service.js';

const createSchema = z.object({ content: postContentSchema.optional() });
const saveSchema = z.object({ content: postContentSchema, version: z.number().int().min(1) });

@ApiTags('posts')
@ApiBearerAuth()
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @ApiOperation({ summary: 'Публикации владельца с отправками по каналам' })
  async list(@Req() req: AuthenticatedRequest) {
    return { items: await this.posts.list(req.auth.userId) };
  }

  @Post()
  @ApiOperation({ summary: 'Создать черновик' })
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.posts.create(req.auth.userId, body.content ?? EMPTY_POST_CONTENT);
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts
      .getOwned(req.auth.userId, id)
      .then((row) => this.posts.view(req.auth.userId, row));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Сохранить черновик (409 — версия устарела)' })
  save(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saveSchema)) body: z.infer<typeof saveSchema>,
  ) {
    return this.posts.save(req.auth.userId, id, body.content, body.version);
  }

  @Post(':id/duplicate')
  duplicate(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.duplicate(req.auth.userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.posts.remove(req.auth.userId, id);
  }
}
