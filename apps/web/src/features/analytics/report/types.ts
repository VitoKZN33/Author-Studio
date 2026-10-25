import type { DayPoint } from '../types';

export type Checkpoint = 'h1' | 'h6' | 'h24' | 'h48';
export const CHECKPOINTS: Checkpoint[] = ['h1', 'h6', 'h24', 'h48'];

export interface Change {
  delta: number;
  pct: number | null;
}

export interface ReportPost {
  key: string;
  messageId: number;
  postedAt: string;
  summary: string;
  publicationId: string | null;
  kind: string;
  rubrics: string[];
  isAd: boolean;
  views: number | null;
  viewsAt: Record<Checkpoint, number | null>;
  forwards: number | null;
  reactions: number | null;
  subscribersAtPost: number | null;
  reachPct: number | null;
  reactionRatePct: number | null;
}

export interface GroupRow {
  key: string;
  posts: number;
  avgViews: number | null;
  avgReactions: number | null;
  enough: boolean;
}

export interface LinkItem {
  id: string;
  title: string;
  targetUrl: string;
  shortUrl: string;
  isAd: boolean;
  channelId: string | null;
  channelTitle: string | null;
  createdAt: string;
  total: { clicks: number; unique: number };
  period: { clicks: number; unique: number } | null;
}

export interface Report {
  channel: { id: string; title: string };
  timezone: string;
  days: number;
  coverage: { subscribersSince: string | null; intervalMinutes: number };
  audience: {
    current: { value: number; measuredAt: string } | null;
    changes: { day: Change | null; week: Change | null; month: Change | null };
    joins: number | null;
    leaves: number | null;
    net: number | null;
    series: DayPoint[];
    markers: { postedAt: string; summary: string }[];
  };
  reach: {
    postsWithViews: number;
    totalViews: number | null;
    avgViews: number | null;
    avgReachPct: number | null;
    avgAt: Record<Checkpoint, number | null>;
    avgForwards: number | null;
    avgReactions: number | null;
    posts: ReportPost[];
  };
  engagement: {
    avgReactions: number | null;
    avgForwards: number | null;
    reactionRatePct: number | null;
    forwardRatePct: number | null;
    postsMeasured: number;
  };
  effectiveness: {
    metric: 'views' | 'reactions';
    bestTime: {
      cells: { weekday: number; slot: number; n: number; avg: number | null }[];
      total: number;
      overallAvg: number | null;
      best: { weekday: number; slot: number; n: number; avg: number | null } | null;
      confidence: 'insufficient' | 'low' | 'medium';
    };
    byWeekday: { weekday: number; posts: number; avg: number | null }[];
    bySlot: { slot: number; posts: number; avg: number | null }[];
    schedule: {
      planned: number;
      onTime: number;
      late: number;
      failed: number;
      immediate: number;
      avgDelayMin: number | null;
      totalPosts: number;
      outsideApp: number;
    };
    frequency: {
      postsPerWeek: number;
      activeDays: number;
      buckets: { perDay: string; days: number; avgPerPost: number | null }[];
      recommendation: string | null;
    };
    types: GroupRow[];
    rubrics: GroupRow[];
  };
  ads: {
    posts: ReportPost[];
    count: number;
    avgViews: number | null;
    avgReachPct: number | null;
    regularAvgViews: number | null;
  };
  links: { items: LinkItem[]; clicks: number; unique: number };
}

/** Число по-русски: 1 250, 12,5. null — «—». */
export function num(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(v)}${suffix}`;
}

export function signedNum(v: number): string {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v))}`;
}
