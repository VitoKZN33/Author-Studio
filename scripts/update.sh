#!/usr/bin/env bash
# Обновление установки: резервная копия → git pull → сборка → миграции → запуск → проверка.
# Использование (на сервере, в каталоге проекта): ./scripts/update.sh
set -Eeuo pipefail

# Тело в функции: bash прочитает скрипт целиком до git pull, который может его изменить.
main() {
  cd "$(dirname "$0")/.."

  if [[ ! -f .env ]]; then
    echo "✗ Нет файла .env. Скопируйте шаблон: cp .env.example .env и заполните его." >&2
    exit 1
  fi

  echo "→ Резервная копия базы данных"
  if [[ -n "$(docker compose ps --status running --quiet postgres 2>/dev/null)" ]]; then
    ./scripts/backup.sh
  else
    echo "  PostgreSQL не запущен (первый запуск?) — копия не создаётся"
  fi

  echo "→ Получение обновлений"
  git pull --ff-only

  echo "→ Сборка образов и запуск (миграции применяются сервисом migrate)"
  docker compose up -d --build --remove-orphans

  echo "→ Проверка состояния"
  ./scripts/status.sh --wait
}

main "$@"
