/**
 * Применение миграций БД. Запускается отдельным шагом развёртывания
 * (сервис `migrate` в compose / scripts/update.sh), а не при старте API.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('Ошибка: DATABASE_URL не задан\n');
    process.exit(1);
  }
  runMigrations(url).then(
    () => process.stdout.write('Миграции применены\n'),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Ошибка применения миграций: ${message.replace(url, '[СКРЫТО]')}\n`);
      process.exit(1);
    },
  );
}
