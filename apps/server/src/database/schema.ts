import { sql } from 'drizzle-orm';
import type { PostContent } from '@author-studio/shared';
import {
  bigint,
  bigserial,
  check,
  index,
  boolean,
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

/**
 * Источник значения метрики:
 * telegram_api — значение, полученное от Telegram (запрос или обновление);
 * manual       — введено владельцем вручную (просмотры, пересылки).
 * Ряды и изменения во времени — измерения системы на основе этих снимков.
 */
/** telegram_api — Bot API, manual — ввёл владелец, mtproto — аккаунт владельца (ADR-036). */
export const metricSource = pgEnum('metric_source', ['telegram_api', 'manual', 'mtproto']);

/** Снимки показателей канала (число подписчиков). История — с момента установки. */
export const channelMetricSnapshots = pgTable(
  'channel_metric_snapshots',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    value: integer('value').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow(),
    source: metricSource('source').notNull(),
    /** Версия способа сбора: меняется, если меняется методика (сравнимость рядов). */
    methodVersion: smallint('method_version').notNull().default(1),
  },
  (t) => [index('channel_metric_snapshots_idx').on(t.channelId, t.metric, t.measuredAt)],
);

/**
 * Сообщения канала, известные системе: опубликованные через приложение и пришедшие
 * в обновлениях channel_post (с момента добавления бота). Историю до этого Bot API не даёт.
 */
export const channelMessages = pgTable(
  'channel_messages',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    messageId: integer('message_id').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    publicationId: uuid('publication_id').references(() => publications.id, {
      onDelete: 'set null',
    }),
    mediaGroupId: text('media_group_id'),
    summary: text('summary').notNull(),
    hasMedia: boolean('has_media').notNull().default(false),
    source: text('source').notNull(),
  },
  (t) => [
    uniqueIndex('channel_messages_unique_idx').on(t.channelId, t.messageId),
    index('channel_messages_posted_idx').on(t.channelId, t.postedAt),
  ],
);

/** Снимки показателей сообщения: реакции (Telegram), просмотры и пересылки (вручную). */
export const messageMetricSnapshots = pgTable(
  'message_metric_snapshots',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    messageId: integer('message_id').notNull(),
    metric: text('metric').notNull(),
    value: integer('value').notNull(),
    details: jsonb('details').$type<Record<string, number>>(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow(),
    source: metricSource('source').notNull(),
  },
  (t) => [
    index('message_metric_snapshots_idx').on(t.channelId, t.messageId, t.metric, t.measuredAt),
  ],
);

/**
 * Вступления и выходы из обновлений chat_member. Кто именно вступил — не храним
 * (минимизация персональных данных); Telegram может присылать не все события.
 */
export const memberEventKind = pgEnum('member_event_kind', ['join', 'leave']);

export const channelMemberEvents = pgTable(
  'channel_member_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    kind: memberEventKind('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    inviteLinkName: text('invite_link_name'),
  },
  (t) => [index('channel_member_events_idx').on(t.channelId, t.occurredAt)],
);

// ---------------------------------------------------------------- Этап 7: AI

/** Состояние подключения к AI-провайдеру по результату последней проверки. */
export const aiStatus = pgEnum('ai_status', ['not_configured', 'unchecked', 'ok', 'error']);

/**
 * Настройки AI установки (одна строка, id = 1). Ключ — только в зашифрованном виде
 * (crypto/secret-box.ts); в интерфейс возвращается маска.
 */
export const aiSettings = pgTable(
  'ai_settings',
  {
    id: smallint('id').primaryKey().default(1),
    enabled: boolean('enabled').notNull().default(false),
    baseUrl: text('base_url').notNull().default('https://api.deepseek.com'),
    model: text('model').notNull().default('deepseek-v4-flash'),
    apiKeyEncrypted: text('api_key_encrypted'),
    apiKeyMask: text('api_key_mask'),
    useProxy: boolean('use_proxy').notNull().default(false),
    /** Описание канала и стиля для подсказок AI (аудитория, тон, запреты). */
    styleGuide: text('style_guide').notNull().default(''),
    timeoutSeconds: integer('timeout_seconds').notNull().default(60),
    maxOutputTokens: integer('max_output_tokens').notNull().default(2000),
    dailyRequestLimit: integer('daily_request_limit').notNull().default(100),
    /** Лимит токенов (вход + выход) в календарный месяц; null — без лимита. */
    monthlyTokenLimit: integer('monthly_token_limit'),
    /** Цены за 1 млн токенов в рублях (вводит владелец) — только для оценки расхода. */
    priceInputPerMillion: integer('price_input_per_million'),
    priceOutputPerMillion: integer('price_output_per_million'),
    status: aiStatus('status').notNull().default('not_configured'),
    lastCheckAt: timestamp('last_check_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [check('ai_settings_singleton', sql`${t.id} = 1`)],
);

export const aiRequestKind = pgEnum('ai_request_kind', ['test', 'text', 'plan', 'analytics']);

/**
 * Журнал запросов к AI для лимитов и учёта расхода. Тексты запросов и ответов
 * не храним — только объёмы, длительность и код ошибки.
 */
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    kind: aiRequestKind('kind').notNull(),
    model: text('model').notNull(),
    ok: boolean('ok').notNull(),
    errorCode: text('error_code'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_requests_created_idx').on(t.createdAt)],
);

// ---------------------------------------------------------------- Просмотры через аккаунт владельца (ADR-036)

export const mtprotoStatus = pgEnum('mtproto_status', [
  'disconnected',
  'active',
  'flood_wait',
  'error',
]);

/**
 * Аккаунт владельца для Telegram API (MTProto) — только чтение просмотров и пересылок
 * его каналов. Сессия = полный доступ к аккаунту, поэтому хранится только в
 * зашифрованном виде и никогда не возвращается в интерфейс.
 */
export const mtprotoAccount = pgTable(
  'mtproto_account',
  {
    id: smallint('id').primaryKey().default(1),
    apiId: integer('api_id'),
    apiHashEncrypted: text('api_hash_encrypted'),
    sessionEncrypted: text('session_encrypted'),
    tgUserId: bigint('tg_user_id', { mode: 'bigint' }),
    displayName: text('display_name'),
    phoneMask: text('phone_mask'),
    status: mtprotoStatus('status').notNull().default('disconnected'),
    floodUntil: timestamp('flood_until', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncCount: integer('last_sync_count'),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [check('mtproto_account_singleton', sql`${t.id} = 1`)],
);
