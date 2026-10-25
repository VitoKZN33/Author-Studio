import type { BestTimeResult } from '../analytics/calc.js';
import type { PostStats } from '../analytics/analytics.service.js';
import { utcToZonedWallTime } from '@author-studio/shared';

/**
 * Сводка статистики для разбора AI. Все числа считает приложение; модель получает
 * готовую таблицу и только интерпретирует её. Эта же сводка показывается владельцу
 * как раздел «Факты» — отдельно от текста модели.
 */

export interface Fact {
  label: string;
  value: string;
  source: 'telegram' | 'manual' | 'calc' | 'system';
}

export interface Sufficiency {
  level: 'insufficient' | 'low' | 'medium' | 'high';
  reasons: string[];
}

export interface OverviewLike {
  current: { value: number; measuredAt: string } | null;
  periodChange: { delta: number; from: number; to: number } | null;
  joinsTotal: number | null;
  leavesTotal: number | null;
  series: { day: string; subscribers: number | null }[];
  coverage: { subscribersSince: string | null };
}

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
export const slotLabel = (weekday: number, slot: number) =>
  `${WEEKDAYS[weekday]} ${slot * 3}:00–${slot * 3 + 3}:00`;

const avg = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null;

export function buildDigest(input: {
  days: number;
  timezone: string;
  overview: OverviewLike;
  posts: PostStats[];
  bestByReactions: BestTimeResult;
}) {
  const { overview: o, posts, days, timezone } = input;
  const withReactions = posts.filter((p) => p.reactions);
  const withViews = posts.filter((p) => p.views);
  const errs = posts.map((p) => p.err).filter((x): x is number => x !== null);
  const measuredDays = o.series.filter((p) => p.subscribers !== null).length;

  const facts: Fact[] = [];
  const push = (label: string, value: string | number | null, source: Fact['source']) =>
    value !== null && facts.push({ label, value: String(value), source });

  push('Подписчиков сейчас', o.current?.value ?? null, 'telegram');
  if (o.periodChange)
    push(
      `Изменение за период (${o.periodChange.from} → ${o.periodChange.to})`,
      (o.periodChange.delta > 0 ? '+' : '') + o.periodChange.delta,
      'system',
    );
  push('Вступили (по событиям Telegram)', o.joinsTotal, 'telegram');
  push('Вышли (по событиям Telegram)', o.leavesTotal, 'telegram');
  push('Постов за период', posts.length, 'system');
  push('Постов с данными о реакциях', withReactions.length, 'telegram');
  push('Постов с введёнными просмотрами', withViews.length, 'manual');
  push('Среднее реакций на пост', avg(withReactions.map((p) => p.reactions!.value)), 'calc');
  push('Средние просмотры (введены вручную)', avg(withViews.map((p) => p.views!.value)), 'calc');
  push('Средний ERR, %', avg(errs), 'calc');
  const top = [...withReactions].sort((a, b) => b.reactions!.value - a.reactions!.value)[0];
  if (top)
    push(
      'Больше всего реакций',
      `${top.reactions!.value} — «${top.summary.slice(0, 60)}»`,
      'telegram',
    );
  if (input.bestByReactions.best)
    push(
      'Время с лучшим откликом по реакциям (оценка)',
      `${slotLabel(input.bestByReactions.best.weekday, input.bestByReactions.best.slot)}, надёжность ${input.bestByReactions.confidence === 'medium' ? 'средняя' : 'низкая'}`,
      'calc',
    );

  // Достаточность данных — правило приложения, а не мнение модели.
  const reasons: string[] = [];
  if (posts.length < 5) reasons.push(`постов за период: ${posts.length} (нужно хотя бы 5)`);
  if (measuredDays < 7) reasons.push(`дней с измерением подписчиков: ${measuredDays} из ${days}`);
  if (withViews.length === 0) reasons.push('просмотры не введены ни для одного поста');
  else if (withViews.length < posts.length / 2)
    reasons.push(`просмотры есть у ${withViews.length} из ${posts.length} постов`);
  if (o.joinsTotal === null) reasons.push('Telegram не присылал события вступлений/выходов');
  const level: Sufficiency['level'] =
    posts.length === 0 && !o.current
      ? 'insufficient'
      : posts.length < 5 || measuredDays < 7
        ? 'low'
        : posts.length < 15 || measuredDays < 21 || withViews.length < posts.length / 2
          ? 'medium'
          : 'high';

  // Компактные данные для модели: только агрегаты и посты без лишних полей.
  const payload = {
    periodDays: days,
    timezone,
    subscribersNow: o.current?.value ?? null,
    subscribersByDay: o.series
      .filter((p) => p.subscribers !== null)
      .map((p) => [p.day, p.subscribers]),
    joins: o.joinsTotal,
    leaves: o.leavesTotal,
    posts: posts.slice(0, 60).map((p) => ({
      at: utcToZonedWallTime(new Date(p.postedAt), timezone).replace('T', ' '),
      text: p.summary.slice(0, 100),
      reactions: p.reactions?.value ?? null,
      views: p.views?.value ?? null,
      forwards: p.forwards?.value ?? null,
      errPercent: p.err,
      subscribersChange24h: p.change24h?.delta ?? null,
      usualDailyGrowth: p.change24h?.baselinePerDay ?? null,
    })),
    bestTimeByReactions: input.bestByReactions.best
      ? {
          slot: slotLabel(input.bestByReactions.best.weekday, input.bestByReactions.best.slot),
          postsInSlot: input.bestByReactions.best.n,
          avgReactionsInSlot: input.bestByReactions.best.avg,
          avgReactionsOverall: input.bestByReactions.overallAvg,
          confidence: input.bestByReactions.confidence,
        }
      : 'недостаточно данных',
  };

  return { facts, payload, sufficiency: { level, reasons } satisfies Sufficiency };
}
