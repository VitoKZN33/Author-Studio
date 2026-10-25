import { sql } from 'drizzle-orm';
import type { PostContent } from '@author-studio/shared';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
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

export interface NotificationPrefs {
  /** Успешные публикации. */
  publishSuccess: boolean;
  /** Ошибки и неизвестный результат публикации. */
  publishProblems: boolean;
  /** Состояние каналов и прав бота. */
  integration: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  publishSuccess: true,
  publishProblems: true,
  integration: true,
};

/** Единственная строка с настройками установки (id всегда 1). */
export const installationSettings = pgTable(
  'installation_settings',
  {
    id: smallint('id').primaryKey().default(1),
    productName: text('product_name').notNull().default('Author Studio'),
    timezone: text('timezone').notNull().default('Europe/Moscow'),
    locale: text('locale').notNull().default('ru'),
    /** Включённые категории уведомлений владельцу (см. NotificationPrefs). */
    notificationPrefs: jsonb('notification_prefs')
      .$type<Partial<NotificationPrefs>>()
      .notNull()
      .default({}),
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

/** Загруженные медиафайлы. Файл лежит в MEDIA_DIR, путь хранится относительно него. */
export const mediaKind = pgEnum('media_kind', ['photo', 'video']);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    kind: mediaKind('kind').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    /** Имя файла внутри MEDIA_DIR (случайное, без пользовательского ввода). */
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name'),
    /** file_id Telegram после первой загрузки: повторная отправка без повторной выгрузки. */
    telegramFileId: text('telegram_file_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('media_assets_owner_idx').on(t.ownerId)],
);

/** Публикация-черновик: содержимое + номер версии для защиты от затирания правок. */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    content: jsonb('content').$type<PostContent>().notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('posts_owner_updated_idx').on(t.ownerId, t.updatedAt)],
);

/**
 * scheduled — ждёт времени отправки (в том числе «сейчас»);
 * sending   — отправка начата, результат ещё не записан;
 * published — Telegram подтвердил отправку;
 * failed    — Telegram отклонил или исчерпаны безопасные повторы;
 * ambiguous — связь прервалась после отправки запроса: неизвестно, опубликовано ли;
 * cancelled — отменено владельцем.
 */
export const publicationStatus = pgEnum('publication_status', [
  'scheduled',
  'sending',
  'published',
  'failed',
  'ambiguous',
  'cancelled',
]);

/** Отправка публикации в конкретный канал. Многоканальная публикация = несколько строк. */
export const publications = pgTable(
  'publications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    status: publicationStatus('status').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    /** Содержимое на момент отправки — история не меняется при правке черновика. */
    sentContent: jsonb('sent_content').$type<PostContent>(),
    messageIds: jsonb('message_ids').$type<number[]>(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [
    index('publications_owner_scheduled_idx').on(t.ownerId, t.scheduledAt),
    index('publications_status_scheduled_idx').on(t.status, t.scheduledAt),
    index('publications_post_idx').on(t.postId),
    // Не больше одной активной отправки поста в канал.
    uniqueIndex('publications_active_unique_idx')
      .on(t.postId, t.channelId)
      .where(sql`status in ('scheduled', 'sending', 'ambiguous')`),
  ],
);

export const attemptResult = pgEnum('publication_attempt_result', [
  'ok',
  'rate_limited',
  'retryable',
  'permanent',
  'ambiguous',
]);

/** Журнал попыток отправки — для разбора ошибок. */
export const publicationAttempts = pgTable(
  'publication_attempts',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    result: attemptResult('result'),
    errorCode: integer('error_code'),
    description: text('description'),
  },
  (t) => [index('publication_attempts_publication_idx').on(t.publicationId)],
);
