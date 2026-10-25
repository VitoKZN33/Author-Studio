import { zonedDayKey } from '@author-studio/shared';

/**
 * Расчёты аналитики — чистые функции. Принцип: отсутствие данных — null, а не 0;
 * изменения — наблюдаемые, без утверждений о причине.
 */

export interface Snapshot {
  value: number;
  measuredAt: Date;
}

export interface MemberEvent {
  kind: 'join' | 'leave';
  occurredAt: Date;
}

export interface DayPoint {
  day: string;
  /** Последнее измерение дня; null — измерений в этот день не было. */
  subscribers: number | null;
  /** Изменение к последнему измерению предыдущего дня с данными; null — не с чем сравнить. */
  change: number | null;
  /** События Telegram; null — до начала поступления событий (или они не приходят). */
  joins: number | null;
  leaves: number | null;
}

/** Дни периода [from; to] в часовом поясе установки, по порядку. */
export function dayKeys(from: Date, to: Date, tz: string): string[] {
  const keys: string[] = [];
  const end = zonedDayKey(to, tz);
  // Шаг 12 ч с дедупликацией — устойчиво к переходам времени.
  for (let t = from.getTime(); ; t += 12 * 3600_000) {
    const k = zonedDayKey(new Date(t), tz);
    if (keys.at(-1) !== k) keys.push(k);
    if (k >= end) break;
  }
  return keys;
}

export function dailySeries(
  snapshots: Snapshot[],
  events: MemberEvent[],
  days: string[],
  tz: string,
  eventsSince: Date | null,
): DayPoint[] {
  const lastByDay = new Map<string, Snapshot>();
  for (const s of [...snapshots].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime())) {
    lastByDay.set(zonedDayKey(s.measuredAt, tz), s);
  }
  const eventsDay = eventsSince ? zonedDayKey(eventsSince, tz) : null;
  const joins = new Map<string, number>();
  const leaves = new Map<string, number>();
  for (const e of events) {
    const k = zonedDayKey(e.occurredAt, tz);
    const m = e.kind === 'join' ? joins : leaves;
    m.set(k, (m.get(k) ?? 0) + 1);
  }

  // Последнее значение до начала периода — база для изменения в первый день.
  const firstDay = days[0] ?? '';
  let prev: number | null = null;
  for (const [k, s] of [...lastByDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (k < firstDay) prev = s.value;
  }

  return days.map((day) => {
    const snap = lastByDay.get(day);
    const subscribers = snap ? snap.value : null;
    const change = subscribers !== null && prev !== null ? subscribers - prev : null;
    if (subscribers !== null) prev = subscribers;
    const tracked = eventsDay !== null && day >= eventsDay;
    return {
      day,
      subscribers,
      change,
      joins: tracked ? (joins.get(day) ?? 0) : null,
      leaves: tracked ? (leaves.get(day) ?? 0) : null,
    };
  });
}

export interface PeriodChange {
  from: number;
  to: number;
  delta: number;
  fromDay: string;
  toDay: string;
}

export function periodChange(series: DayPoint[]): PeriodChange | null {
  const withData = series.filter((p) => p.subscribers !== null);
  if (withData.length < 2) return null;
  const a = withData[0]!;
  const b = withData.at(-1)!;
  return {
    from: a.subscribers!,
    to: b.subscribers!,
    delta: b.subscribers! - a.subscribers!,
    fromDay: a.day,
    toDay: b.day,
  };
}

/** Последнее измерение не позже момента t и не раньше t − maxAge. */
export function valueAt(sorted: Snapshot[], t: Date, maxAgeMs: number): Snapshot | null {
  let found: Snapshot | null = null;
  for (const s of sorted) {
    if (s.measuredAt.getTime() > t.getTime()) break;
    found = s;
  }
  return found && t.getTime() - found.measuredAt.getTime() <= maxAgeMs ? found : null;
}

/** Первое измерение не раньше момента t и не позже t + maxDelay. */
export function valueAfter(sorted: Snapshot[], t: Date, maxDelayMs: number): Snapshot | null {
  const s = sorted.find((x) => x.measuredAt.getTime() >= t.getTime());
  return s && s.measuredAt.getTime() - t.getTime() <= maxDelayMs ? s : null;
}

export interface WindowChange {
  before: number;
  after: number;
  delta: number;
  hours: number;
  /** Средний суточный прирост за 7 дней до момента (база для сравнения); null — нет данных. */
  baselinePerDay: number | null;
}

const TOLERANCE_MS = 90 * 60_000;

/**
 * Изменение числа подписчиков в окне [t; t + hours]. Это наблюдаемое изменение:
 * на него влияют все события окна, а не только конкретный пост.
 */
export function windowChange(
  sorted: Snapshot[],
  t: Date,
  hours: number,
  now = new Date(),
): WindowChange | null {
  const end = new Date(t.getTime() + hours * 3600_000);
  if (end.getTime() > now.getTime()) return null;
  const before = valueAt(sorted, t, TOLERANCE_MS);
  const after = valueAfter(sorted, end, TOLERANCE_MS);
  if (!before || !after) return null;
  const weekAgo = valueAt(sorted, new Date(t.getTime() - 7 * 86_400_000), 6 * 3600_000);
  return {
    before: before.value,
    after: after.value,
    delta: after.value - before.value,
    hours,
    baselinePerDay: weekAgo ? Math.round(((before.value - weekAgo.value) / 7) * 10) / 10 : null,
  };
}

/** ERR = просмотры / подписчики на момент публикации × 100%. null — нет одного из значений. */
export function engagementRate(views: number | null, subscribers: number | null): number | null {
  if (views === null || subscribers === null || subscribers <= 0) return null;
  return Math.round((views / subscribers) * 1000) / 10;
}

export interface TimeCell {
  weekday: number; // 0 = понедельник
  slot: number; // 0..7, интервалы по 3 часа
  n: number;
  avg: number | null;
}

export interface BestTimeResult {
  cells: TimeCell[];
  total: number;
  overallAvg: number | null;
  best: TimeCell | null;
  /** insufficient — выводов нет; low/medium — качественная оценка надёжности. */
  confidence: 'insufficient' | 'low' | 'medium';
}

export const BEST_TIME_MIN_TOTAL = 15;
export const BEST_TIME_MIN_CELL = 3;

function weekdayAndHour(d: Date, tz: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const wd = parts.find((p) => p.type === 'weekday')!.value;
  const hour = Number(parts.find((p) => p.type === 'hour')!.value);
  return { weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd), hour };
}

/**
 * Сравнение публикаций по дню недели и времени. Это корреляция в выборке, а не
 * доказательство: на результат влияют темы, форматы и внешние события.
 */
export function bestTime(posts: { postedAt: Date; value: number }[], tz: string): BestTimeResult {
  const acc = new Map<string, { n: number; sum: number }>();
  for (const p of posts) {
    const { weekday, hour } = weekdayAndHour(p.postedAt, tz);
    const key = `${weekday}:${Math.floor(hour / 3)}`;
    const a = acc.get(key) ?? { n: 0, sum: 0 };
    a.n++;
    a.sum += p.value;
    acc.set(key, a);
  }
  const cells: TimeCell[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let slot = 0; slot < 8; slot++) {
      const a = acc.get(`${weekday}:${slot}`);
      cells.push({
        weekday,
        slot,
        n: a?.n ?? 0,
        avg: a ? Math.round((a.sum / a.n) * 10) / 10 : null,
      });
    }
  }
  const total = posts.length;
  const overallAvg = total
    ? Math.round((posts.reduce((s, p) => s + p.value, 0) / total) * 10) / 10
    : null;
  if (total < BEST_TIME_MIN_TOTAL)
    return { cells, total, overallAvg, best: null, confidence: 'insufficient' };
  const candidates = cells.filter(
    (c) => c.n >= BEST_TIME_MIN_CELL && c.avg !== null && overallAvg !== null && c.avg > overallAvg,
  );
  const best = candidates.sort((a, b) => b.avg! - a.avg! || b.n - a.n)[0] ?? null;
  if (!best) return { cells, total, overallAvg, best: null, confidence: 'insufficient' };
  return {
    cells,
    total,
    overallAvg,
    best,
    confidence: best.n >= 8 && total >= 40 ? 'medium' : 'low',
  };
}
