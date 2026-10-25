import { Module } from '@nestjs/common';
import { PublicationExecutor } from './publication-executor.service.js';
import { PublicationsProcessor } from './publications.processor.js';
import { TelegramPublisher } from './telegram-publisher.js';

/** Worker: отправка публикаций и реконсилятор расписания. */
@Module({ providers: [TelegramPublisher, PublicationExecutor, PublicationsProcessor] })
export class PublishingWorkerModule {}
