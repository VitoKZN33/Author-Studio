/**
 * Перевод «настенного» времени в часовом поясе установки в момент UTC и обратно.
 * Нужен, чтобы время публикации не зависело от часового пояса браузера и сервера:
 * пользователь вводит время установки (например, Europe/Moscow), хранится UTC.
 */

function partsInZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Смещение пояса относительно UTC в момент date, в минутах. */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/**
 * «2026-10-25T14:30» в поясе timeZone → Date (UTC).
 * Неоднозначное время (осенний переход, час повторяется) — берётся первое наступление.
 * Несуществующее время (весенний переход) — сдвигается вперёд на величину перехода.
 */
export function zonedWallTimeToUtc(wall: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
  if (!m) throw new Error('Ожидается время в формате ГГГГ-ММ-ДДTчч:мм');
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const offsets = new Set([
    zoneOffsetMinutes(new Date(naive - 12 * 3600_000), timeZone),
    zoneOffsetMinutes(new Date(naive + 12 * 3600_000), timeZone),
  ]);
  const matches = [...offsets]
    .map((o) => naive - o * 60_000)
    .filter((t) => utcToZonedWallTime(new Date(t), timeZone) === wall)
    .sort((a, b) => a - b);
  if (matches.length > 0) return new Date(matches[0]!);
  // Время попало в «дыру» перехода: смещение до перехода даёт момент сразу после него.
  const before = zoneOffsetMinutes(new Date(naive - 12 * 3600_000), timeZone);
  return new Date(naive - before * 60_000);
}

/** Date → «2026-10-25T14:30» в поясе timeZone (для input type=datetime-local). */
export function utcToZonedWallTime(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Ключ дня «2026-10-25» в поясе timeZone (для календаря). */
export function zonedDayKey(date: Date, timeZone: string): string {
  return utcToZonedWallTime(date, timeZone).slice(0, 10);
}
