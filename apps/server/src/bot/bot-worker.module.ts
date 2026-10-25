import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { NotificationsProcessor } from '../notifications/notifications.processor.js';
import { PollingService } from './polling.service.js';
import { TelegramSetupService } from './telegram-setup.service.js';
import { UpdateRouter } from './update-router.service.js';
import { UpdatesProcessor } from './updates.processor.js';

@Module({
  imports: [ChannelsModule],
  providers: [
    UpdateRouter,
    UpdatesProcessor,
    NotificationsProcessor,
    TelegramSetupService,
    PollingService,
  ],
})
export class BotWorkerModule {}
