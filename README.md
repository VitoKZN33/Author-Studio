# Author Studio

Самостоятельно разворачиваемый инструмент для владельцев Telegram-каналов:
публикации и контент-план, рекламный кабинет, аналитика, AI-ассистент.
Работает как Telegram Mini App и бот на сервере покупателя, без зависимости от
сервера продавца.

**Состояние:** этап 3 (Telegram и авторизация) — реализован, ожидает проверки на сервере.
Работают: вход в Mini App через Telegram, бот с webhook, подключение каналов и
проверка прав бота, уведомления владельцу о проблемах с каналами.

## Быстрый старт (разработка)

Требуется Node.js 24 LTS, pnpm 12, PostgreSQL и Redis.

```bash
pnpm install
pnpm check                      # формат, линтер, сборка, типы, unit-тесты
pnpm test:integration           # нужны TEST_DATABASE_URL и TEST_REDIS_URL, см. docs/TESTING.md
```

## Сервер

```bash
cp .env.example .env && chmod 600 .env   # заполнить
docker compose up -d --build
./scripts/status.sh --wait
```

Обновление: `./scripts/update.sh`. Подробно — [DEPLOYMENT](docs/DEPLOYMENT.md).

Документация:

- [Архитектура](docs/ARCHITECTURE.md)
- [Ограничения Telegram API и план аналитики](docs/TELEGRAM_API_LIMITATIONS.md)
- [AI и ОРД](docs/INTEGRATIONS.md)
- [Безопасность](docs/SECURITY.md)
- [Решения](docs/DECISIONS.md) · [Риски](docs/RISKS.md)
- [Дорожная карта](docs/ROADMAP.md) · [Критерии приёмки](docs/ACCEPTANCE_CRITERIA.md)
- [Развёртывание](docs/DEPLOYMENT.md) · [Эксплуатация](docs/OPERATIONS.md) · [Тестирование](docs/TESTING.md)
