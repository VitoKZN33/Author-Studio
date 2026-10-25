import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller.js';
import { ChannelsModule } from './channels.module.js';

@Module({ imports: [ChannelsModule], controllers: [ChannelsController] })
export class ChannelsApiModule {}
