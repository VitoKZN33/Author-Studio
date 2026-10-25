import { z } from 'zod';

const BOT_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const booleanFromString = z
  .enum(['true', 'false', '1', '0'], { error: 'ожидается true или false' })
  .transform((v) => v === 'true' || v === '1');

/** Пустая строка в .env трактуется как «не задано». */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'], {
        error: 'допустимые значения: development, test, production',
      })
      .default('development'),
    APP_NAME: z.string().trim().min(1).max(64).default('Author Studio'),
    APP_TIMEZONE: z
      .string()
      .default('Europe/Moscow')
      .refine(isValidTimeZone, { error: 'неизвестный часовой пояс IANA (пример: Europe/Moscow)' }),
    PUBLIC_URL: z.url({ error: 'ожидается полный адрес, например https://studio.example.ru' }),
    PORT: z.coerce.number({ error: 'ожидается номер порта' }).int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'], {
        error: 'допустимые значения: fatal, error, warn, info, debug, trace',
      })
      .default('info'),
    DATABASE_URL: z
      .string({ error: 'не задан' })
      .regex(/^postgres(ql)?:\/\//, { error: 'ожидается адрес вида postgresql://…' }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z
      .string({ error: 'не задан' })
      .regex(/^rediss?:\/\//, { error: 'ожидается адрес вида redis://…' }),
    APP_ENCRYPTION_KEY: z
      .string({ error: 'не задан (сгенерируйте: openssl rand -base64 32)' })
      .refine((v) => Buffer.from(v, 'base64').length === 32, {
        error: 'должен быть 32 байта в base64 (сгенерируйте: openssl rand -base64 32)',
      }),
    // Используются с этапа 3. До этого необязательны.
    TELEGRAM_BOT_TOKEN: optional(
      z.string().regex(BOT_TOKEN_RE, { error: 'неверный формат токена бота от @BotFather' }),
    ),
    OWNER_TELEGRAM_ID: optional(
      z.string().regex(/^\d{1,20}$/, { error: 'ожидается числовой Telegram ID' }),
    ),
    TELEGRAM_WEBHOOK_SECRET: optional(
      z.string().regex(/^[A-Za-z0-9_-]{32,256}$/, {
        error: 'от 32 символов: латиница, цифры, _ и - (сгенерируйте: openssl rand -hex 32)',
      }),
    ),
    ENABLE_API_DOCS: optional(booleanFromString),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_URL'],
        message: 'в production требуется https://',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Значения переменных, которые нельзя выводить в логи. */
export const SECRET_ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'APP_ENCRYPTION_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
] as const satisfies readonly (keyof Env)[];

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      'Ошибка конфигурации окружения. Исправьте файл .env и перезапустите сервис:\n' +
        problems.map((p) => `  — ${p}`).join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(общая проверка)';
    const missing = issue.code === 'invalid_type' && source[key] === undefined;
    return `${key}: ${missing ? 'обязательный параметр не задан' : issue.message}`;
  });
  throw new EnvValidationError(problems);
}
