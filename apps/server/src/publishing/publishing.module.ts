import { Module } from '@nestjs/common';
import { PostsController } from '../posts/posts.controller.js';
import { PostsService } from '../posts/posts.service.js';
import { PublicationsController } from './publications.controller.js';
import { PublishingService } from './publishing.service.js';

/** API: черновики и управление отправками. */
@Module({
  controllers: [PostsController, PublicationsController],
  providers: [PostsService, PublishingService],
  exports: [PostsService],
})
export class PublishingApiModule {}
