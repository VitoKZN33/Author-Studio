import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { createScrubbingStream, createSecretScrubber } from './secret-scrubber.js';
import { REDACT_PATHS } from './logger.options.js';

const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const DB_URL = 'postgresql://app:VeryS3cretPass@postgres:5432/app';
const ENC_KEY = Buffer.alloc(32, 9).toString('base64');

function captureLogger() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _e, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const scrub = createSecretScrubber([BOT_TOKEN, DB_URL, ENC_KEY]);
  const logger = pino(
    { redact: { paths: REDACT_PATHS, censor: '[СКРЫТО]' } },
    createScrubbingStream(scrub, sink),
  );
  return { logger, output: () => lines.join('') };
}

describe('фильтрация секретов в логах', () => {
  it('скрывает известные значения в сообщении, объекте и ошибке', () => {
    const { logger, output } = captureLogger();
    logger.info(`подключение ${DB_URL}`);
    logger.info({ cfg: { key: ENC_KEY } }, 'конфиг');
    logger.error(new Error(`Telegram отказал: https://api.telegram.org/bot${BOT_TOKEN}/getMe`));
    const out = output();
    expect(out).not.toContain(BOT_TOKEN);
    expect(out).not.toContain('VeryS3cretPass');
    expect(out).not.toContain(ENC_KEY);
    expect(out).toContain('[СКРЫТО]');
  });

  it('распознаёт секреты по формату, даже если их нет в списке известных', () => {
    const scrub = createSecretScrubber([]);
    const other = '987654321:ZZHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
    expect(scrub(`token=${other}`)).not.toContain(other);
    expect(scrub('redis://default:hunter2pass@redis:6379')).not.toContain('hunter2pass');
    expect(scrub('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456')).not.toContain(
      'abcdefghijklmnopqrstuvwxyz123456',
    );
    expect(scrub('key sk-proj-abcdefghijklmnop1234')).not.toContain('sk-proj-abcdefghijklmnop1234');
  });

  it('скрывает поля по путям redact (заголовок Authorization, apiKey)', () => {
    const { logger, output } = captureLogger();
    logger.info({ req: { headers: { authorization: 'Bearer short' } }, ai: { apiKey: 'x1y2z3' } });
    const out = output();
    expect(out).not.toContain('Bearer short');
    expect(out).not.toContain('x1y2z3');
  });

  it('не портит обычные сообщения', () => {
    const scrub = createSecretScrubber([BOT_TOKEN]);
    expect(scrub('Публикация 42 запланирована на 10:00')).toBe(
      'Публикация 42 запланирована на 10:00',
    );
  });
});
