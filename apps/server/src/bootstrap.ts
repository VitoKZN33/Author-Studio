import { EnvValidationError } from './config/env.schema.js';
import { loadConfig } from './config/config.module.js';

/**
 * Проверяет конфигурацию до создания приложения: при ошибке выводит понятное
 * сообщение на русском без стектрейса и завершает процесс с кодом 1.
 */
export function ensureConfigOrExit(): void {
  try {
    loadConfig();
  } catch (e) {
    if (e instanceof EnvValidationError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
}
