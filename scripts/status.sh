#!/usr/bin/env bash
# Состояние сервисов. С флагом --wait ждёт готовности API (до 180 с).
set -Eeuo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--wait" ]]; then
  for _ in $(seq 1 60); do
    state="$(docker compose ps --format '{{.Health}}' api 2>/dev/null || true)"
    [[ "$state" == "healthy" ]] && break
    sleep 3
  done
fi

docker compose ps

echo
echo "Сводное состояние приложения:"
if ! docker compose exec -T api node -e "
fetch('http://127.0.0.1:3000/api/health/status')
  .then(r => r.json())
  .then(b => {
    const names = { database: 'База данных', redis: 'Redis', worker: 'Фоновый обработчик' };
    for (const [k, v] of Object.entries(b.checks)) {
      console.log((v.status === 'ok' ? '  ✓ ' : '  ✗ ') + (names[k] ?? k) + (v.message ? ' — ' + v.message : ''));
    }
    process.exit(b.status === 'ok' ? 0 : 1);
  })
  .catch(() => { console.log('  ✗ API не отвечает'); process.exit(1); });
"; then
  echo
  echo "Есть проблемы. Логи: docker compose logs --tail=100 api worker" >&2
  exit 1
fi
