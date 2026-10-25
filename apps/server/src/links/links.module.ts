import { Module } from '@nestjs/common';
import { LinksController, RedirectController } from './links.controller.js';
import { LinksService } from './links.service.js';

@Module({
  controllers: [LinksController, RedirectController],
  providers: [LinksService],
  exports: [LinksService],
})
export class LinksApiModule {}
