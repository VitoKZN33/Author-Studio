import pg from 'pg';
import { Redis } from 'ioredis';
import { runMigrations } from '../../src/database/migrate.js';
import { testEnv } from './env.js';

/** Чистая схема БД и пустой Redis перед прогоном, затем миграции. */
export default async function setup() {
  const { db, redis } = testEnv();
  const pool = new pg.Pool({ connectionString: db, max: 1 });
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE;');
  await pool.query('CREATE SCHEMA public;');
  await pool.end();
  await runMigrations(db);

  const r = new Redis(redis);
  await r.flushdb();
  r.disconnect();
}
