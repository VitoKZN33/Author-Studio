# Архитектура — Author Studio

Статус документа: **черновик этапа 1, ожидает подтверждения владельца проекта.**
Дата: 2026-10-25.

## 0. Исходное состояние

Рабочий репозиторий отсутствует: в рабочей среде нет git-репозитория и кода,
приватный репозиторий GitHub к сессии не подключён. Проектирование ведётся с нуля.

## 1. Архитектурная схема

```
                    Telegram (клиенты iOS / Android / Desktop)
                         │                       │
              Mini App (WebView)            Bot API (HTTPS)
                         │                       │  webhook + secret_token
                         ▼                       ▼
 ┌──────────────────────────── VPS покупателя ───────────────────────────┐
 │  ┌──────────── Caddy (TLS, авто-продление) ─────────────┐             │
 │  │ /            → статическая сборка Next.js (Mini App) │             │
 │  │ /api/*       → api                                   │             │
 │  │ /tg/webhook  → api (проверка X-Telegram-Bot-Api-     │             │
 │  │                Secret-Token)                         │             │
 │  │ /r/<slug>    → api (редирект трекинговых ссылок)     │             │
 │  │ /report/<t>  → статическая страница + /api/public/*  │             │
 │  └──────────────────────────────────────────────────────┘             │
 │        │                                                              │
 │  ┌─────▼─────┐   задания (BullMQ)   ┌──────────┐                      │
 │  │   api     │ ───────────────────▶ │  worker  │ ──▶ Bot API          │
 │  │ NestJS    │ ◀── статусы в БД ─── │  NestJS  │ ──▶ AI-провайдер     │
 │  └─────┬─────┘                      └────┬─────┘ ──▶ ОРД (адаптер)    │
 │        │                                 │                            │
 │  ┌─────▼─────────────────────────────────▼─────┐                      │
 │  │ PostgreSQL (источник истины)   Redis (очереди)│  только внутр. сеть │
 │  └──────────────────────────────────────────────┘                     │
 │  /var/lib/author-studio/media   — медиафайлы (том Docker)             │
 │  /var/backups/author-studio     — резервные копии (cron на хосте)     │
 └───────────────────────────────────────────────────────────────────────┘
```

Принципы:
- **Модульный монолит**: один кодовый backend, два процесса — `api` (HTTP) и `worker`
  (очереди, планировщик, сбор метрик, исходящие уведомления).
- **PostgreSQL — источник истины** для заданий. Redis/BullMQ — механизм доставки.
  Потеря Redis не теряет публикации: реконсилятор пересоздаёт задания из БД.
- **Никакой зависимости от сервера продавца**: нет лицензирования, телеметрии,
  внешних обязательных сервисов, кроме Telegram и выбранных владельцем интеграций.

## 2. Структура проекта (pnpm workspaces)

```
author-studio/
├── apps/
│   ├── web/                 Next.js (static export) — Mini App + публичный отчёт
│   │   ├── src/app/         маршруты: overview, posts, calendar, channels, ads,
│   │   │                    analytics, ai, settings, report/[token]
│   │   ├── src/features/    UI по бизнес-модулям
│   │   ├── src/shared/      UI-kit, api-клиент, telegram-обвязка, i18n
│   │   └── messages/ru.json словари
│   └── server/              NestJS — один код, две точки входа
│       ├── src/main.api.ts
│       ├── src/main.worker.ts
│       ├── src/modules/
│       │   ├── config/        валидация env, настройки установки
│       │   ├── auth/          initData, сессии, guard владельца
│       │   ├── telegram/      клиент Bot API, webhook, rate limiter
│       │   ├── bot/           команды, deep links, уведомления
│       │   ├── channels/      подключение, проверка прав
│       │   ├── posts/         черновики, версии, валидация, рендер в entities
│       │   ├── media/         загрузка, хранение, проверка файлов
│       │   ├── publishing/    публикации, попытки, идемпотентность
│       │   ├── scheduler/     реконсилятор, восстановление просроченных
│       │   ├── analytics/     снимки метрик, расчёты
│       │   ├── ads/           заказы, статусы, закрепление/удаление
│       │   ├── tracking/      трекинговые ссылки, клики, антинакрутка
│       │   ├── reports/       публичные отчёты
│       │   ├── ord/           ручной процесс + интерфейс адаптера ОРД
│       │   ├── ai/            провайдеры, лимиты, сценарии
│       │   ├── notifications/ outbox, группировка, настройки категорий
│       │   ├── audit/         журнал событий
│       │   └── health/        liveness/readiness
│       └── prisma/            schema.prisma, migrations/
├── packages/
│   └── shared/              общие типы, zod-схемы, лимиты Telegram, i18n-ключи
├── deploy/
│   ├── compose.yaml
│   ├── Caddyfile
│   └── .env.example
├── scripts/                 install.sh, update.sh, backup.sh, restore.sh, status.sh
└── docs/
```

## 3. Основные сущности БД

Все даты — `timestamptz` (UTC). Часовой пояс установки — IANA-строка в настройках.
Публичные идентификаторы — случайные токены; внутренние `id` — UUIDv7.

| Сущность | Назначение и ключевые поля |
|---|---|
| `InstallationSettings` | singleton: название продукта, часовой пояс, локаль, флаги модулей |
| `User` | `telegramId`, `role` (OWNER; задел под EDITOR/VIEWER) |
| `Session` | хэш токена, `userId`, `expiresAt`, `revokedAt`, `lastSeenAt` |
| `Channel` | `tgChatId`, title, username, `status` (ACTIVE / RIGHTS_MISSING / BOT_REMOVED / DISCONNECTED), снимок прав, `rightsCheckedAt` |
| `Post` | черновик: документ редактора (JSON), `version` (оптимистическая блокировка), тип (обычный/рекламный) |
| `PostMedia` | порядок, ссылка на `MediaAsset`, подпись |
| `MediaAsset` | путь, sha256, mime, размер, размеры, кэш `telegramFileId` |
| `PostButton` | ряд/позиция, текст, URL |
| `Publication` | Post × Channel: `scheduledAt`, `status`, `messageIds[]`, `publishedAt`, `idempotencyKey` |
| `PublicationAttempt` | номер, начало/конец, результат (OK / TRANSIENT / PERMANENT / **AMBIGUOUS**), код ошибки, `retryAfter` |
| `ChannelMetricSnapshot` | канал, метрика, значение, `measuredAt`, `source`, `methodVersion` |
| `MessageMetricSnapshot` | сообщение, метрика (reactions…), значение, `measuredAt`, `source` |
| `MemberEvent` | вступления/выходы из `chat_member` (если Telegram их доставляет), `inviteLinkId` |
| `InviteLink` | ссылка-приглашение с именем (для атрибуции подписок) |
| `Advertiser` | имя, контакты, реквизиты (для ОРД), заметки |
| `AdOrder` | канал, рекламодатель, цена, валюта, `paymentStatus`, `lifecycleStatus`, даты, закреп/удаление, ERID |
| `AdOrderEvent` | история статусов и действий |
| `AdPlacement` | связь заказа с `Publication`, `pinUntil`, `deleteAt`, фактические времена |
| `TrackingLink` | случайный slug, целевой URL (валидирован), заказ |
| `ClickEvent` | время, суточно-солёный хэш IP, класс UA, `isSuspect` — без сырых IP |
| `PublicReport` | хэш токена, заказ, набор видимых полей, `revokedAt`, `expiresAt` |
| `OrdRecord` | ERID, номер договора, статусы ручного/автоматического процесса |
| `AiProviderConfig` | тип, baseUrl, модель, **зашифрованный** ключ, лимиты |
| `AiUsage` | сценарий, токены, оценка стоимости, время |
| `NotificationPreference` / `NotificationOutbox` | категории, очередь исходящих сообщений бота |
| `AuditLog` | актор, действие, сущность, метаданные (без секретов) |

Ключевые инварианты (ограничения БД):
- `Publication (postId, channelId, scheduledAt)` уникальна в активных статусах.
- `idempotencyKey` уникален; повтор задания с тем же ключом не создаёт нового отправления.
- Все бизнес-таблицы ссылаются на `ownerId` → проверка принадлежности в сервисном
  слое и в запросах (задел под нескольких пользователей).

## 4. Взаимодействие Mini App, API, бота и фоновых задач

**Вход:** Mini App → `POST /api/auth/telegram` с `initData` → сервер проверяет HMAC и
`auth_date` (≤ 1 ч), сверяет `user.id` с `OWNER_TELEGRAM_ID` → выдаёт непрозрачный
токен сессии (12 ч, хранится хэшем). Далее — заголовок `Authorization: Bearer`.
Cookies не используются (WebView Telegram Web/Desktop ведут себя по-разному с
cookies в iframe), поэтому CSRF к API неприменим.

**Отложенная публикация:**
1. API сохраняет `Publication(status=SCHEDULED)` в транзакции и ставит delayed-job
   `publish:{publicationId}` с `jobId = publicationId` (дубликаты отбрасываются BullMQ).
2. Worker при старте задания берёт строку `SELECT … FOR UPDATE SKIP LOCKED` и переводит
   `SCHEDULED → SENDING`, создаёт `PublicationAttempt`.
3. Вызов Bot API (`sendMessage` / `sendPhoto` / `sendMediaGroup`), учёт rate limit.
4. Успех → `PUBLISHED`, `messageIds`. Ошибка 429 → повтор через `retry_after`.
   4xx постоянная → `FAILED`. Сетевая ошибка **после отправки запроса** →
   `AMBIGUOUS`: автоповтора нет, владельцу уходит уведомление «проверьте канал»
   с кнопками «Опубликовано» / «Отправить повторно».
5. Реконсилятор (каждую минуту): находит `SCHEDULED` с прошедшим `scheduledAt` без
   задания в Redis и ставит заново; `SENDING` дольше N минут → `AMBIGUOUS`.

**Webhook бота:** API принимает обновления, проверяет секрет, кладёт их в очередь
`tg-updates` и сразу отвечает 200. Worker обрабатывает: `my_chat_member` (права бота
изменены/бот удалён), `chat_member`, `channel_post`, `message_reaction_count`, команды.

**Уведомления:** любое событие пишет строку в `NotificationOutbox`; отдельный
обработчик группирует (окно 1–5 мин), учитывает настройки категорий и отправляет.

## 5. Развёртывание (Docker Compose)

Долгоживущие сервисы: `caddy`, `api`, `worker`, `postgres`, `redis`.
Одноразовый: `migrate` (prisma migrate deploy) — запускается скриптом обновления.
Отдельного контейнера frontend нет: Next.js собирается в статику (`output: 'export'`),
которую раздаёт Caddy. Обоснование — в DECISIONS.md (ADR-003).

- PostgreSQL и Redis без опубликованных портов, только внутренняя сеть.
- `restart: unless-stopped` + docker в systemd → автозапуск после перезагрузки.
- healthchecks: `pg_isready`, `redis-cli ping`, `GET /api/health/ready` (БД + Redis),
  worker — heartbeat в Redis, проверяемый readiness API.
- Резервные копии: `scripts/backup.sh` через cron хоста (`pg_dump -Fc` + медиа),
  ротация поколений, права 600. Подробно — этап 2/8, `docs/BACKUP_RESTORE.md`.

Рабочий цикл доставки (раздел 20 ТЗ): я пушу в приватный репозиторий, на сервере:

```
cd /opt/author-studio && ./scripts/update.sh
```

`update.sh` = резервная копия → `git pull` → сборка → `migrate` → `up -d` → проверка
здоровья. Вариант `git pull && docker compose up -d --build` тоже будет работать, но
без резервной копии перед миграцией — поэтому рекомендую скрипт.
