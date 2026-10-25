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
  uniqueIndex,
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

/**
 * Сессии Mini App. Хранится только SHA-256 токена: утечка БД не даёт войти.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_idx').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

/**
 * detected       — бот добавлен в канал администратором, канал ещё не подключён;
 * active         — подключён, все обязательные права есть;
 * rights_missing — подключён, но не хватает обязательных прав;
 * bot_removed    — бот удалён из канала или лишён прав администратора;
 * disconnected   — владелец отключил канал в приложении.
 */
export const channelStatus = pgEnum('channel_status', [
  'detected',
  'active',
  'rights_missing',
  'bot_removed',
  'disconnected',
]);

/** Снимок прав бота в канале на момент последней проверки. */
export interface BotRightsSnapshot {
  isAdmin: boolean;
  canPostMessages: boolean;
  canEditMessages: boolean;
  canDeleteMessages: boolean;
  canInviteUsers: boolean;
  canManageChat: boolean;
}

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Владелец записи (задел под нескольких пользователей). */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    tgChatId: bigint('tg_chat_id', { mode: 'bigint' }).notNull(),
    title: text('title').notNull(),
    username: text('username'),
    status: channelStatus('status').notNull(),
    botRights: jsonb('bot_rights').$type<BotRightsSnapshot>(),
    rightsCheckedAt: timestamp('rights_checked_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('channels_tg_chat_id_idx').on(t.tgChatId),
    index('channels_owner_status_idx').on(t.ownerId, t.status),
  ],
);
