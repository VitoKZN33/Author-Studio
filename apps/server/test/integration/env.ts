/**
 * Интеграционные тесты работают с настоящими PostgreSQL и Redis.
 * Адреса задаются переменными TEST_DATABASE_URL и TEST_REDIS_URL
 * (см. docs/TESTING.md). Без них тесты падают, а не пропускаются.
 */
export function testEnv() {
  const db = process.env.TEST_DATABASE_URL;
  const redis = process.env.TEST_REDIS_URL;
  if (!db || !redis) {
    throw new Error(
      'Для интеграционных тестов задайте TEST_DATABASE_URL и TEST_REDIS_URL (docs/TESTING.md)',
    );
  }
  return { db, redis };
}

/** Устанавливает переменные окружения приложения для теста. */
export function applyAppEnv(overrides: Record<string, string> = {}) {
  const { db, redis } = testEnv();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://studio.test',
    DATABASE_URL: db,
    REDIS_URL: redis,
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    LOG_LEVEL: 'fatal',
    ...overrides,
  });
}
