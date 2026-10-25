import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Этап 2: базовые таблицы установки. Бизнес-таблицы добавляются на своих этапах
 * отдельными расширяющими миграциями (см. docs/DECISIONS.md, ADR-005).
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Единственная строка с настройками установки (id всегда 1). */
export const installationSettings = pgTable(
  'installation_settings',
  {
    id: smallint('id').primaryKey().default(1),
    productName: text('product_name').notNull().default('Author Studio'),
    timezone: text('timezone').notNull().default('Europe/Moscow'),
    locale: text('locale').notNull().default('ru'),
    ...timestamps,
  },
  (t) => [check('installation_settings_singleton', sql`${t.id} = 1`)],
);

/** Роли: в MVP только владелец; перечисление расширяется без переделки таблиц. */
export const userRole = pgEnum('user_role', ['owner']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  telegramId: bigint('telegram_id', { mode: 'bigint' }).notNull().unique(),
  role: userRole('role').notNull(),
  ...timestamps,
});

/** Журнал значимых событий. Секреты и лишние персональные данные сюда не пишутся. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Например: system.started, channel.connected, publication.sent. */
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('audit_log_occurred_at_idx').on(t.occurredAt),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
  ],
);
