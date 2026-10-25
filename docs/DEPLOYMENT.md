# Развёртывание (состояние этапа 2)

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

Сборка образов и запуск compose **в рабочей среде разработки не выполнялись**
(Docker Hub недоступен). Первая реальная проверка — на вашем сервере или в CI.
