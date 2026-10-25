#!/usr/bin/env bash
# Резервная копия PostgreSQL (формат custom) и медиафайлов. Хранит последние BACKUP_KEEP копий.
# Внимание: копии на том же сервере не защищают от потери сервера целиком —
# регулярно выносите их во внешнее хранилище (docs/BACKUP_RESTORE.md, этап 8).
set -Eeuo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
umask 077
mkdir -p "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/db-$stamp.dump"
tmp="$target.partial"

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$tmp"

# Проверка: файл непустой и читается pg_restore.
if [[ ! -s "$tmp" ]] || ! docker compose exec -T postgres pg_restore --list < "$tmp" > /dev/null; then
  rm -f "$tmp"
  echo "✗ Резервная копия не создана или повреждена" >&2
  exit 1
fi
mv "$tmp" "$target"
echo "  ✓ $target ($(du -h "$target" | cut -f1))"

# Медиафайлы публикаций (том media): архив tar из контейнера api.
media_target="$BACKUP_DIR/media-$stamp.tar"
if docker compose exec -T api sh -c 'tar -C /var/lib/author-studio -cf - media' > "$media_target.partial" &&
  tar -tf "$media_target.partial" > /dev/null; then
  mv "$media_target.partial" "$media_target"
  echo "  ✓ $media_target ($(du -h "$media_target" | cut -f1))"
else
  rm -f "$media_target.partial"
  echo "✗ Архив медиафайлов не создан" >&2
  exit 1
fi

# Ротация: имена содержат UTC-время, поэтому обратная сортировка = от новых к старым.
shopt -s nullglob
for pattern in 'db-*.dump' 'media-*.tar'; do
  # shellcheck disable=SC2206
  files=("$BACKUP_DIR"/$pattern)
  mapfile -t old < <(printf '%s\n' "${files[@]}" | sort -r | tail -n +"$((BACKUP_KEEP + 1))")
  for f in "${old[@]}"; do rm -f -- "$f"; done
done
