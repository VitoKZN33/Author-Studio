import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ApiModule } from './api.module.js';
import { loadConfig } from './config/config.module.js';

export const API_PREFIX = 'api';
export const JSON_BODY_LIMIT = '1mb';

export async function createApiApp(): Promise<NestExpressApplication> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  // За Caddy: доверяем только заголовкам от прокси во внутренней сети.
  app.set('trust proxy', 'loopback, uniquelocal');
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.use(
    helmet({
      // CSP для страниц Mini App задаёт Caddy; API отдаёт только JSON.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.enableShutdownHooks();

  const docsEnabled = config.ENABLE_API_DOCS ?? config.NODE_ENV !== 'production';
  if (docsEnabled) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle(`${config.APP_NAME} API`).setVersion('0.1.0').build(),
    );
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, doc);
  }
  return app;
}
