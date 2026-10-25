import { Module } from '@nestjs/common';
import { AnalyticsCoreModule } from './analytics-core.module.js';
import { MetricsCollector } from './metrics-collector.js';

@Module({ imports: [AnalyticsCoreModule], providers: [MetricsCollector] })
export class AnalyticsWorkerModule {}
