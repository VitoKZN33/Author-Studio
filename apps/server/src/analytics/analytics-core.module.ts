import { Module } from '@nestjs/common';
import { AnalyticsIngestService } from './ingest.service.js';

@Module({ providers: [AnalyticsIngestService], exports: [AnalyticsIngestService] })
export class AnalyticsCoreModule {}
