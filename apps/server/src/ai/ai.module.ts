import { Module } from '@nestjs/common';
import { AnalyticsApiModule } from '../analytics/analytics-api.module.js';
import { PublishingApiModule } from '../publishing/publishing.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';

/** API: AI-ассистент. Вызовы модели идут из процесса api синхронно, с тайм-аутом. */
@Module({
  imports: [AnalyticsApiModule, PublishingApiModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiApiModule {}
