import 'reflect-metadata';
import { ensureConfigOrExit } from './bootstrap.js';

// Конфигурация проверяется до импорта модулей приложения: они читают её при загрузке.
ensureConfigOrExit();
const { loadConfig } = await import('./config/config.module.js');
const { createApiApp } = await import('./create-api-app.js');
const app = await createApiApp();
await app.listen(loadConfig().PORT, '0.0.0.0');
