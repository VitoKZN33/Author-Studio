# Развёртывание (состояние этапа 3)

Полная инструкция для покупателя (подготовка чистого Ubuntu, автоматический
`install.sh`, DNS, firewall, проверка на чистом сервере) — этап 8. Ниже —
минимальный порядок, достаточный для запуска фундамента.

## Требования

- Ubuntu 24.04 LTS (или другая поддерживаемая), 2 ГБ RAM, 20 ГБ диска;
- Docker Engine с плагином Compose v2;
- домен с A-записью на IP сервера; открытые порты 80 и 443 (TCP) и 443 (UDP).

## Первый запуск

```bash
git clone <адрес репозитория> /opt/author-studio && cd /opt/author-studio
cp .env.example .env && chmod 600 .env
nano .env    # PUBLIC_DOMAIN, ACME_EMAIL, POSTGRES_PASSWORD, APP_ENCRYPTION_KEY
docker compose up -d --build
./scripts/status.sh --wait
```

Сгенерировать секреты: `openssl rand -hex 24` (пароль БД), `openssl rand -base64 32`
(ключ шифрования).

## Бот и домен (этап 3)

1. **Бот.** В @BotFather: `/newbot` → получить токен. Больше ничего в BotFather
   настраивать не нужно: webhook, кнопку меню и команду `/start` установка
   регистрирует сама при запуске.
2. **Ваш Telegram ID.** Напишите @userinfobot — он ответит числом.
3. **Домен.** A-запись домена → IP сервера. Порты 80 и 443 должны быть свободны
   (остановите другие веб-серверы на этом сервере).
4. **`.env`:**
   ```
   PUBLIC_DOMAIN=ваш-домен
   ACME_EMAIL=ваша-почта
   TELEGRAM_BOT_TOKEN=токен
   OWNER_TELEGRAM_ID=ваш ID
   TELEGRAM_WEBHOOK_SECRET=результат openssl rand -hex 32
   ```
5. Запуск: `docker compose up -d --build`, затем `./scripts/status.sh --wait`.
   В логе worker должно быть «Бот настроен» (`docker compose logs worker | grep Бот`).
6. **Откройте бота и нажмите «Старт»** — без этого Telegram не разрешит боту
   присылать вам уведомления.
7. Нажмите «Открыть Author Studio» → раздел «Каналы» → добавьте бота
   администратором канала по инструкции на экране.

### Сервер не может подключиться к Telegram

Признак: в логе worker — «Нет связи с Telegram» или «сеть недоступна или тайм-аут»,
бот не отвечает на `/start`, нет кнопки «Открыть». Проверка с сервера:

```bash
curl -s -m 10 -o /dev/null -w "%{http_code}\n" https://api.telegram.org
```

`000` — доступа нет (так бывает в ряде дата-центров РФ). Решения:

1. **Прокси за пределами РФ** (SOCKS5 или HTTP). Проверьте его:
   `curl -s -m 10 -o /dev/null -w "%{http_code}\n" -x socks5h://логин:пароль@хост:порт https://api.telegram.org`
   (ответ `302` — прокси работает). Затем в `.env`:
   ```
   TELEGRAM_PROXY_URL=socks5h://логин:пароль@хост:порт
   TELEGRAM_UPDATES_MODE=polling
   ```
   и `docker compose up -d`. Режим polling не требует, чтобы Telegram мог достучаться
   до вашего сервера.
2. **Сервер за пределами РФ** — тогда прокси не нужен, режим webhook.

Если вход не работает: убедитесь, что время на сервере синхронизировано
(`timedatectl`), — данные входа Telegram действуют 1 час.

## Обновление

```bash
cd /opt/author-studio && ./scripts/update.sh
```

Скрипт: резервная копия БД → `git pull` → сборка → `docker compose up -d`
(сервис `migrate` применяет миграции до старта api/worker) → проверка состояния.

## Что запускается

| Сервис     | Назначение                                    | Наружу  |
| ---------- | --------------------------------------------- | ------- |
| `caddy`    | HTTPS, статика Mini App, проксирование `/api` | 80, 443 |
| `api`      | HTTP API (NestJS)                             | нет     |
| `worker`   | очереди, фоновые задачи                       | нет     |
| `migrate`  | применяет миграции и завершается              | нет     |
| `postgres` | база данных (сеть без выхода в интернет)      | нет     |
| `redis`    | очереди, AOF включён (сеть без выхода)        | нет     |

Автозапуск после перезагрузки: `restart: unless-stopped` (Docker должен быть
включён в systemd: `systemctl enable docker`).

## Проверено / не проверено

- ✅ Сборка образов и запуск всех сервисов с HTTPS (сертификат Caddy для localhost) —
  в GitHub Actions на каждый push.
- ⏳ Реальный домен, сертификат Let's Encrypt, Ubuntu VPS — проверяются при первой
  установке на ваш сервер (этап 3 потребует домен для Mini App).
