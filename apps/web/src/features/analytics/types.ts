export interface DayPoint {
  day: string;
  subscribers: number | null;
  change: number | null;
  joins: number | null;
  leaves: number | null;
}

export interface Overview {
  channel: { id: string; title: string; username: string | null; status: string };
  timezone: string;
  current: { value: number; measuredAt: string } | null;
  periodChange: { from: number; to: number; delta: number; fromDay: string; toDay: string } | null;
  joinsTotal: number | null;
  leavesTotal: number | null;
  series: DayPoint[];
  markers: { postedAt: string; summary: string }[];
  coverage: {
    subscribersSince: string | null;
    memberEventsSince: string | null;
    intervalMinutes: number;
  };
}

export interface MetricValue {
  value: number;
  measuredAt: string;
  source: 'telegram_api' | 'manual' | 'mtproto';
}

export interface PostStats {
  key: string;
  messageIds: number[];
  primaryMessageId: number;
  postedAt: string;
  summary: string;
  publicationId: string | null;
  reactions: MetricValue | null;
  views: MetricValue | null;
  forwards: MetricValue | null;
  subscribersAtPost: number | null;
  err: number | null;
  change24h: {
    before: number;
    after: number;
    delta: number;
    hours: number;
    baselinePerDay: number | null;
  } | null;
}

export interface BestTime {
  metric: 'reactions' | 'views';
  days: number;
  timezone: string;
  postsInPeriod: number;
  cells: { weekday: number; slot: number; n: number; avg: number | null }[];
  total: number;
  overallAvg: number | null;
  best: { weekday: number; slot: number; n: number; avg: number | null } | null;
  confidence: 'insufficient' | 'low' | 'medium';
}

/** Класс значения для пометки в интерфейсе (ТЗ 8.2: факт / измерение / расчёт / нет данных). */
export type ValueKind = 'fact' | 'measured' | 'manual' | 'estimate' | 'none';

export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Последовательная шкала (один бирюзовый оттенок, 7 ступеней). Цвета заданы
 * переменными --heat-0…6 в globals.css отдельно для светлой и тёмной темы:
 * больше значение — сильнее ступень. Текст поверх — --heat-ink-N (контраст ≥ 4.5:1).
 */
export const HEAT_STEPS = 7;

export function heatIndex(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(HEAT_STEPS - 1, Math.floor((value / max) * (HEAT_STEPS - 1) + 0.0001));
}

export const heatColor = (i: number) => `var(--heat-${i})`;
export const heatText = (i: number) => `var(--heat-ink-${i})`;
