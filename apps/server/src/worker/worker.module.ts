import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AnalyticsWorkerModule } from '../analytics/analytics-worker.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { BotWorkerModule } from '../bot/bot-worker.module.js';
import { MediaModule } from '../media/media.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PublishingWorkerModule } from '../publishing/publishing-worker.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { ConfigModule, loadConfig } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { buildLoggerParams } from '../logging/logger.options.js';
import { QueueModule } from '../queue/queue.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { HeartbeatService } from './heartbeat.service.js';
import { SystemProcessor } from './system.processor.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot(buildLoggerParams(loadConfig(), 'worker')),
    DatabaseModule,
    RedisModule,
    QueueModule,
    AuditModule,
    TelegramModule,
    SettingsModule,
    NotificationsModule,
    MediaModule,
    BotWorkerModule,
    PublishingWorkerModule,
    AnalyticsWorkerModule,
  ],
  providers: [HeartbeatService, SystemProcessor],
})
export class WorkerModule {}
