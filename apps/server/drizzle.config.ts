import { defineConfig } from 'drizzle-kit';

// Генерация SQL-миграций из src/database/schema.ts. Подключение к БД не требуется.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  strict: true,
});
