import { zonedDayKey } from '@author-studio/shared';
import { bestTime, engagementRate, valueAt, type BestTimeResult, type Snapshot } from './calc.js';

/**
 * Расчёты сводного отчёта «Статистика» (шесть разделов). Только из собранных данных:
 * если показателя нет — null, а не 0. Все выводы о «лучшем» — с порогами выборки.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const CHECKPOINTS = [1, 6, 24, 48] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];
/** Точка «через N часов» засчитывается, если измерение не дальше 30 минут от неё. */
const CHECKPOINT_TOLERANCE = 30 * 60_000;

export interface ReportMessage {
  messageId: number;
  postedAt: Date;
  publicationId: string | null;
  mediaGroupId: string | null;
  summary: string;
  contentKind: string | null;
  hashtags: string[];
  isAd: boolean;
}

export interface MetricRow {
  messageId: number;
  metric: string;
  value: number;
  measuredAt: Date;
}

export interface ReportPost {
  key: string;
  /** Сообщение, к которому привязан ручной ввод просмотров. */
  messageId: number;
  postedAt: string;
  summary: string;
  publicationId: string | null;
  kind: string;
  rubrics: string[];
  isAd: boolean;
  views: number | null;
  viewsAt: Record<`h${Checkpoint}`, number | null>;
  forwards: number | null;
  reactions: number | null;
  subscribersAtPost: number | null;
  /** Охват: просмотры / подписчики на момент поста, %. */
  reachPct: number | null;
  /** Реакций на 100 просмотров. */
  reactionRatePct: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) =>
  xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
const pct = (a: number, b: number) => (b > 0 ? round1((a / b) * 100) : null);

function nearest(sorted: Snapshot[], t: number, tolerance: number): Snapshot | null {
  let best: Snapshot | null = null;
  for (const s of sorted) {
    const d = Math.abs(s.measuredAt.getTime() - t);
    if (d <= tolerance && (!best || d < Math.abs(best.measuredAt.getTime() - t))) best = s;
  }
  return best;
}

// ------------------------------------------------------------------ 1. Аудитория

export interface Change {
  delta: number;
  pct: number | null;
}

export function audienceChanges(subs: Snapshot[], now: Date) {
  const current = subs.at(-1) ?? null;
  const change = (hours: number): Change | null => {
    if (!current) return null;
    // Значение «тогда»: последнее измерение не позже момента, не старше 6 ч.
    const then = valueAt(subs, new Date(now.getTime() - hours * HOUR), 6 * HOUR);
    if (!then) return null;
    const delta = current.value - then.value;
    return { delta, pct: then.value > 0 ? round1((delta / then.value) * 100) : null };
  };
  return { day: change(24), week: change(24 * 7), month: change(24 * 30) };
}

// ------------------------------------------------------------------ Посты

export function buildPosts(
  messages: ReportMessage[],
  metrics: MetricRow[],
  subs: Snapshot[],
  now: Date,
): ReportPost[] {
  const groups = new Map<string, ReportMessage[]>();
  for (const m of [...messages].sort(
    (a, b) => a.postedAt.getTime() - b.postedAt.getTime() || a.messageId - b.messageId,
  )) {
    const key = m.publicationId
      ? `p:${m.publicationId}`
      : m.mediaGroupId
        ? `g:${m.mediaGroupId}`
        : `m:${m.messageId}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const byMsg = new Map<string, Snapshot[]>();
  for (const r of [...metrics].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime())) {
    const k = `${r.messageId}:${r.metric}`;
    byMsg.set(k, [...(byMsg.get(k) ?? []), { value: r.value, measuredAt: r.measuredAt }]);
  }
  const latest = (id: number, metric: string) =>
    byMsg.get(`${id}:${metric}`)?.at(-1)?.value ?? null;

  return [...groups.entries()].map(([key, list]) => {
    const primary = list[0]!;
    const viewsHist = byMsg.get(`${primary.messageId}:views`) ?? [];
    const views = latest(primary.messageId, 'views');
    const reactionParts = list
      .map((m) => latest(m.messageId, 'reactions'))
      .filter((x): x is number => x !== null);
    const reactions = reactionParts.length ? reactionParts.reduce((s, x) => s + x, 0) : null;
    const subsAt = valueAt(subs, primary.postedAt, 6 * HOUR)?.value ?? null;
    const viewsAt = Object.fromEntries(
      CHECKPOINTS.map((h) => {
        const t = primary.postedAt.getTime() + h * HOUR;
        return [
          `h${h}`,
          t > now.getTime() ? null : (nearest(viewsHist, t, CHECKPOINT_TOLERANCE)?.value ?? null),
        ];
      }),
    ) as ReportPost['viewsAt'];
    const kind = list.length > 1 ? 'album' : (primary.contentKind ?? 'unknown');
    return {
      key,
      messageId: primary.messageId,
      postedAt: primary.postedAt.toISOString(),
      summary:
        list.find((m) => m.summary && m.summary !== 'Фото' && m.summary !== 'Видео')?.summary ??
        primary.summary,
      publicationId: primary.publicationId,
      kind,
      rubrics: [...new Set(list.flatMap((m) => m.hashtags))],
      isAd: list.some((m) => m.isAd),
      views,
      viewsAt,
      forwards: latest(primary.messageId, 'forwards'),
      reactions,
      subscribersAtPost: subsAt,
      reachPct: engagementRate(views, subsAt),
      reactionRatePct: views !== null && reactions !== null ? pct(reactions, views) : null,
    };
  });
}

// ------------------------------------------------------------------ 2–3. Охват и вовлечённость

export function reachSummary(posts: ReportPost[]) {
  const withViews = posts.filter((p) => p.views !== null);
  const both = posts.filter((p) => p.views !== null && p.reactions !== null);
  const sumViews = both.reduce((s, p) => s + p.views!, 0);
  const sumReactions = both.reduce((s, p) => s + p.reactions!, 0);
  const fw = posts.filter((p) => p.views !== null && p.forwards !== null);
  return {
    reach: {
      postsWithViews: withViews.length,
      totalViews: withViews.length ? withViews.reduce((s, p) => s + p.views!, 0) : null,
      avgViews: avg(withViews.map((p) => p.views!)),
      avgReachPct: avg(posts.map((p) => p.reachPct).filter((x): x is number => x !== null)),
      avgAt: Object.fromEntries(
        CHECKPOINTS.map((h) => [
          `h${h}`,
          avg(posts.map((p) => p.viewsAt[`h${h}`]).filter((x): x is number => x !== null)),
        ]),
      ) as Record<`h${Checkpoint}`, number | null>,
      avgForwards: avg(posts.map((p) => p.forwards).filter((x): x is number => x !== null)),
      avgReactions: avg(posts.map((p) => p.reactions).filter((x): x is number => x !== null)),
    },
    engagement: {
      avgReactions: avg(posts.map((p) => p.reactions).filter((x): x is number => x !== null)),
      avgForwards: avg(posts.map((p) => p.forwards).filter((x): x is number => x !== null)),
      /** Реакций на 100 просмотров по постам, где известны оба значения. */
      reactionRatePct: both.length ? pct(sumReactions, sumViews) : null,
      forwardRatePct: fw.length
        ? pct(
            fw.reduce((s, p) => s + p.forwards!, 0),
            fw.reduce((s, p) => s + p.views!, 0),
          )
        : null,
      postsMeasured: both.length,
    },
  };
}

// ------------------------------------------------------------------ 4. Эффективность

export const MIN_GROUP_POSTS = 3;

function weekdayHour(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(
    parts.find((p) => p.type === 'weekday')!.value,
  );
  return { weekday: wd, hour: Number(parts.find((p) => p.type === 'hour')!.value) };
}

export interface PlanRow {
  status: string;
  scheduledAt: Date;
  publishedAt: Date | null;
  createdAt: Date;
}

export function effectiveness(posts: ReportPost[], plan: PlanRow[], tz: string, days: number) {
  // Сравниваем по просмотрам, если они известны хотя бы у стольких же постов, что и реакции.
  const withViews = posts.filter((p) => p.views !== null).length;
  const withReactions = posts.filter((p) => p.reactions !== null).length;
  const useViews = withViews > 0 && withViews >= withReactions;
  const metric: 'views' | 'reactions' = useViews ? 'views' : 'reactions';
  const value = (p: ReportPost) => (useViews ? p.views : p.reactions);
  const sample = posts
    .filter((p) => value(p) !== null)
    .map((p) => ({ postedAt: new Date(p.postedAt), value: value(p)! }));
  const best: BestTimeResult = bestTime(sample, tz);

  const byWeekday = [0, 1, 2, 3, 4, 5, 6].map((w) => {
    const xs = sample.filter((s) => weekdayHour(s.postedAt, tz).weekday === w).map((s) => s.value);
    return { weekday: w, posts: xs.length, avg: avg(xs) };
  });
  const bySlot = [0, 1, 2, 3, 4, 5, 6, 7].map((slot) => {
    const xs = sample
      .filter((s) => Math.floor(weekdayHour(s.postedAt, tz).hour / 3) === slot)
      .map((s) => s.value);
    return { slot, posts: xs.length, avg: avg(xs) };
  });

  // План и факт: отправки из приложения, срок которых наступил в периоде.
  const due = plan.filter((p) => p.status !== 'cancelled' && p.scheduledAt.getTime() <= Date.now());
  const scheduled = due.filter((p) => p.scheduledAt.getTime() - p.createdAt.getTime() > 60_000);
  const delays = scheduled
    .filter((p) => p.publishedAt)
    .map((p) => Math.max(0, p.publishedAt!.getTime() - p.scheduledAt.getTime()) / 60_000);
  const schedule = {
    planned: scheduled.length,
    onTime: delays.filter((d) => d <= 5).length,
    late: delays.filter((d) => d > 5).length,
    failed: scheduled.filter((p) => p.status === 'failed' || p.status === 'ambiguous').length,
    immediate: due.length - scheduled.length,
    avgDelayMin: delays.length ? round1(delays.reduce((s, x) => s + x, 0) / delays.length) : null,
    totalPosts: posts.length,
    outsideApp: posts.filter((p) => !p.publicationId).length,
  };

  // Частота: сколько постов в день и сколько в среднем набирает пост в такие дни.
  const perDay = new Map<string, ReportPost[]>();
  for (const p of posts) {
    const k = zonedDayKey(new Date(p.postedAt), tz);
    perDay.set(k, [...(perDay.get(k) ?? []), p]);
  }
  const bucketOf = (n: number) => (n >= 3 ? '3+' : String(n));
  const buckets = ['1', '2', '3+'].map((b) => {
    const dayLists = [...perDay.values()].filter((l) => bucketOf(l.length) === b);
    const vals = dayLists
      .flat()
      .map(value)
      .filter((x): x is number => x !== null);
    return { perDay: b, days: dayLists.length, avgPerPost: avg(vals) };
  });
  const eligible = buckets.filter((b) => b.days >= MIN_GROUP_POSTS && b.avgPerPost !== null);
  const bestBucket =
    eligible.length >= 2 && posts.length >= 10
      ? eligible.sort((a, b) => b.avgPerPost! - a.avgPerPost!)[0]!
      : null;
  const frequency = {
    postsPerWeek: round1((posts.length / Math.max(1, days)) * 7),
    activeDays: perDay.size,
    buckets,
    recommendation: bestBucket?.perDay ?? null,
  };

  const groupBy = (keyOf: (p: ReportPost) => string[]) => {
    const m = new Map<string, ReportPost[]>();
    for (const p of posts) for (const k of keyOf(p)) m.set(k, [...(m.get(k) ?? []), p]);
    return [...m.entries()]
      .map(([k, list]) => ({
        key: k,
        posts: list.length,
        avgViews: avg(list.map((p) => p.views).filter((x): x is number => x !== null)),
        avgReactions: avg(list.map((p) => p.reactions).filter((x): x is number => x !== null)),
        enough: list.length >= MIN_GROUP_POSTS,
      }))
      .sort((a, b) => b.posts - a.posts);
  };

  return {
    metric,
    bestTime: best,
    byWeekday,
    bySlot,
    schedule,
    frequency,
    types: groupBy((p) => [p.kind]),
    rubrics: groupBy((p) => p.rubrics).slice(0, 10),
  };
}

// ------------------------------------------------------------------ 5. Реклама

export function adsSummary(posts: ReportPost[]) {
  const ads = posts.filter((p) => p.isAd);
  const regular = posts.filter((p) => !p.isAd);
  const vals = (l: ReportPost[]) => l.map((p) => p.views).filter((x): x is number => x !== null);
  return {
    posts: ads,
    count: ads.length,
    avgViews: avg(vals(ads)),
    avgReachPct: avg(ads.map((p) => p.reachPct).filter((x): x is number => x !== null)),
    regularAvgViews: avg(vals(regular)),
  };
}

export { DAY };
