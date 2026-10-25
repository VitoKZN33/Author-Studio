import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/database/migrate.js';
import { testEnv } from './env.js';

const pool = new pg.Pool({ connectionString: testEnv().db, max: 2 });
afterAll(() => pool.end());

describe('миграции БД', () => {
  it('создают базовые таблицы и строку настроек установки', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' order by 1",
    );
    expect(rows.map((r) => r.table_name)).toEqual(['audit_log', 'installation_settings', 'users']);
    const settings = await pool.query(
      'select product_name, timezone, locale from installation_settings',
    );
    expect(settings.rows).toEqual([
      { product_name: 'Author Studio', timezone: 'Europe/Moscow', locale: 'ru' },
    ]);
  });

  it('повторный запуск ничего не меняет', async () => {
    const before = await pool.query('select count(*)::int as n from drizzle.__drizzle_migrations');
    await runMigrations(testEnv().db);
    const after = await pool.query('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const settings = await pool.query('select count(*)::int as n from installation_settings');
    expect(settings.rows[0].n).toBe(1);
  });

  it('настройки установки — единственная строка (ограничение БД)', async () => {
    await expect(pool.query('insert into installation_settings (id) values (2)')).rejects.toThrow(
      /installation_settings_singleton/,
    );
  });

  it('telegram_id пользователя уникален', async () => {
    await pool.query("insert into users (telegram_id, role) values (100500, 'owner')");
    await expect(
      pool.query("insert into users (telegram_id, role) values (100500, 'owner')"),
    ).rejects.toThrow(/users_telegram_id_unique/);
    await pool.query('delete from users where telegram_id = 100500');
  });
});
