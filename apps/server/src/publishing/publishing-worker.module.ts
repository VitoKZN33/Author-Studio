import { Module } from '@nestjs/common';
import { AnalyticsCoreModule } from '../analytics/analytics-core.module.js';
import { MtprotoCoreModule } from '../mtproto/mtproto.module.js';
import { PublicationDeleter } from './publication-deleter.service.js';
import { PublicationExecutor } from './publication-executor.service.js';
import { PublicationsProcessor } from './publications.processor.js';
import { TelegramPublisher } from './telegram-publisher.js';

/** Worker: отправка публикаций и реконсилятор расписания. */
@Module({
  imports: [AnalyticsCoreModule, MtprotoCoreModule],
  providers: [TelegramPublisher, PublicationExecutor, PublicationsProcessor, PublicationDeleter],
})
export class PublishingWorkerModule {}
