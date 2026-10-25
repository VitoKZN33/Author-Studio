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
  source: 'telegram_api' | 'manual';
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

/** Ступени последовательной шкалы (один оттенок, проверены для тёмного фона). */
export const HEAT_STEPS = [
  '#184f95',
  '#1c5cab',
  '#256abf',
  '#2a78d6',
  '#3987e5',
  '#5598e7',
  '#86b6ef',
];

export function heatColor(value: number, max: number): string {
  if (max <= 0) return HEAT_STEPS[0]!;
  const i = Math.min(
    HEAT_STEPS.length - 1,
    Math.floor((value / max) * (HEAT_STEPS.length - 1) + 0.0001),
  );
  return HEAT_STEPS[i]!;
}

/** Цвет текста поверх ступени шкалы: на светлых ступенях — тёмный (контраст ≥ 4.5:1). */
export function heatText(background: string): string {
  return HEAT_STEPS.indexOf(background) >= 4 ? '#0e0f11' : '#ffffff';
}
