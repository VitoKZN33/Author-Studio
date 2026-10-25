import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from './env.schema.js';

const valid = {
  PUBLIC_URL: 'https://studio.example.ru',
  DATABASE_URL: 'postgresql://app:pw@postgres:5432/app',
  REDIS_URL: 'redis://redis:6379',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

function problemsOf(src: Record<string, string | undefined>): string[] {
  try {
    parseEnv(src);
  } catch (e) {
    if (e instanceof EnvValidationError) return e.problems;
    throw e;
  }
  return [];
}

describe('parseEnv', () => {
  it('принимает минимальную корректную конфигурацию и подставляет значения по умолчанию', () => {
    const env = parseEnv(valid);
    expect(env.APP_NAME).toBe('Author Studio');
    expect(env.APP_TIMEZONE).toBe('Europe/Moscow');
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it('перечисляет все отсутствующие обязательные параметры по-русски', () => {
    const problems = problemsOf({});
    expect(problems).toEqual(
      expect.arrayContaining([
        'PUBLIC_URL: обязательный параметр не задан',
        'DATABASE_URL: обязательный параметр не задан',
        'REDIS_URL: обязательный параметр не задан',
        'APP_ENCRYPTION_KEY: обязательный параметр не задан',
      ]),
    );
  });

  it('отклоняет ключ шифрования неверной длины', () => {
    const problems = problemsOf({ ...valid, APP_ENCRYPTION_KEY: 'c2hvcnQ=' });
    expect(problems.join()).toContain('32 байта');
  });

  it('отклоняет неизвестный часовой пояс', () => {
    expect(problemsOf({ ...valid, APP_TIMEZONE: 'Mars/Olympus' }).join()).toContain('часовой пояс');
  });

  it('требует https в production', () => {
    const problems = problemsOf({
      ...valid,
      NODE_ENV: 'production',
      PUBLIC_URL: 'http://studio.example.ru',
    });
    expect(problems).toContain('PUBLIC_URL: в production требуется https://');
  });

  it('проверяет формат токена бота, но не выводит его значение в ошибке', () => {
    const problems = problemsOf({ ...valid, TELEGRAM_BOT_TOKEN: 'secret-but-wrong' });
    expect(problems.join()).toContain('TELEGRAM_BOT_TOKEN');
    expect(problems.join()).not.toContain('secret-but-wrong');
  });

  it('пустая строка необязательного параметра считается незаданной', () => {
    expect(parseEnv({ ...valid, TELEGRAM_BOT_TOKEN: '' }).TELEGRAM_BOT_TOKEN).toBeUndefined();
  });
});
