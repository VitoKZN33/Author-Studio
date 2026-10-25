import { Module } from '@nestjs/common';
import { ChannelsService } from './channels.service.js';

/** Сервис каналов используется и API (контроллер), и worker (обновления Telegram). */
@Module({ providers: [ChannelsService], exports: [ChannelsService] })
export class ChannelsModule {}
