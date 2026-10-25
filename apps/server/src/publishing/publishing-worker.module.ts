import { Module } from '@nestjs/common';
import { AnalyticsCoreModule } from '../analytics/analytics-core.module.js';
import { PublicationExecutor } from './publication-executor.service.js';
import { PublicationsProcessor } from './publications.processor.js';
import { TelegramPublisher } from './telegram-publisher.js';

/** Worker: отправка публикаций и реконсилятор расписания. */
@Module({
  imports: [AnalyticsCoreModule],
  providers: [TelegramPublisher, PublicationExecutor, PublicationsProcessor],
})
export class PublishingWorkerModule {}
