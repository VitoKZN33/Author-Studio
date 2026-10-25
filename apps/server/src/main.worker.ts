import 'reflect-metadata';
import { ensureConfigOrExit } from './bootstrap.js';

// Конфигурация проверяется до импорта модулей приложения: они читают её при загрузке.
ensureConfigOrExit();
const { NestFactory } = await import('@nestjs/core');
const { Logger } = await import('nestjs-pino');
const { WorkerModule } = await import('./worker/worker.module.js');
const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
app.get(Logger).log('Фоновый обработчик запущен');
