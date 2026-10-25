import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from '../audit/audit.module.js';
import { BotWorkerModule } from '../bot/bot-worker.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
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
    NotificationsModule,
    BotWorkerModule,
  ],
  providers: [HeartbeatService, SystemProcessor],
})
export class WorkerModule {}
