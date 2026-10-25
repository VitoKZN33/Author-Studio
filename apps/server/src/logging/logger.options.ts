import type { Params } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/config.module.js';
import { SECRET_ENV_KEYS } from '../config/env.schema.js';
import { createScrubbingStream, createSecretScrubber } from './secret-scrubber.js';

/** Пути в объекте лога, значения которых заменяются (второй рубеж после фильтра строк). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-telegram-bot-api-secret-token"]',
  'res.headers["set-cookie"]',
  '*.token',
  '*.password',
  '*.apiKey',
  '*.secret',
  '*.botToken',
  '*.initData',
];

export function buildLoggerParams(
  config: AppConfig,
  processName: 'api' | 'worker',
  target: NodeJS.WritableStream = process.stdout,
): Params {
  const scrub = createSecretScrubber(SECRET_ENV_KEYS.map((k) => config[k]));
  return {
    pinoHttp: [
      {
        level: config.LOG_LEVEL,
        base: { service: processName },
        redact: { paths: REDACT_PATHS, censor: '[СКРЫТО]' },
        genReqId: (req: IncomingMessage) => {
          const incoming = req.headers['x-request-id'];
          return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming)
            ? incoming
            : randomUUID();
        },
        autoLogging: {
          ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/api/health'),
        },
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            // query-строка может содержать токены публичных ссылок — не пишем её
            url: req.url.split('?')[0],
          }),
        },
      },
      createScrubbingStream(scrub, target),
    ],
  };
}
