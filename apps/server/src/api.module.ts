import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AnalyticsApiModule } from './analytics/analytics-api.module.js';
import { AiApiModule } from './ai/ai.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { BotApiModule } from './bot/bot-api.module.js';
import { ChannelsApiModule } from './channels/channels-api.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { MediaApiModule } from './media/media-api.module.js';
import { MediaModule } from './media/media.module.js';
import { PublishingApiModule } from './publishing/publishing.module.js';
import { SettingsApiModule } from './settings/settings-api.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SystemModule } from './system/system.module.js';
import { TelegramModule } from './telegram/telegram.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { ConfigModule, loadConfig } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { buildLoggerParams } from './logging/logger.options.js';
import { QueueModule } from './queue/queue.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot(buildLoggerParams(loadConfig(), 'api')),
    DatabaseModule,
    RedisModule,
    QueueModule,
    AuditModule,
    TelegramModule,
    SettingsModule,
    NotificationsModule,
    MediaModule,
    // Общий лимит запросов к API с одного адреса; для входа — строже (AuthController).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    AuthModule,
    HealthModule,
    BotApiModule,
    ChannelsApiModule,
    SystemModule,
    MediaApiModule,
    PublishingApiModule,
    SettingsApiModule,
    AnalyticsApiModule,
    AiApiModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // Порядок важен: сначала лимит частоты, затем проверка сессии.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class ApiModule {}
