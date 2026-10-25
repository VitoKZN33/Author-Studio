import { describe, expect, it } from 'vitest';
import {
  adsSummary,
  audienceChanges,
  buildPosts,
  effectiveness,
  reachSummary,
  type ReportMessage,
} from './report.js';

const H = 3600_000;
const now = new Date('2026-10-25T12:00:00Z');
const at = (msAgo: number) => new Date(now.getTime() - msAgo);
const msg = (id: number, ago: number, extra: Partial<ReportMessage> = {}): ReportMessage => ({
  messageId: id,
  postedAt: at(ago),
  publicationId: null,
  mediaGroupId: null,
  summary: `пост ${id}`,
  contentKind: 'text',
  hashtags: [],
  isAd: false,
  ...extra,
});

describe('аудитория', () => {
  it('прирост за день/неделю/месяц и процент; нет данных — null', () => {
    const subs = [
      { value: 100, measuredAt: at(30 * 24 * H) },
      { value: 150, measuredAt: at(7 * 24 * H) },
      { value: 190, measuredAt: at(24 * H) },
      { value: 200, measuredAt: at(0) },
    ];
    const c = audienceChanges(subs, now);
    expect(c.day).toEqual({ delta: 10, pct: 5.3 });
    expect(c.week).toEqual({ delta: 50, pct: 33.3 });
    expect(c.month).toEqual({ delta: 100, pct: 100 });
    expect(audienceChanges([{ value: 5, measuredAt: at(0) }], now).day).toBeNull();
  });
});

describe('посты: просмотры через 1/6/24/48 ч, охват, реакции на 100 просмотров', () => {
  const messages = [
    msg(1, 50 * H),
    msg(2, 3 * H, { mediaGroupId: 'g' }),
    msg(3, 3 * H, { mediaGroupId: 'g' }),
  ];
  const metrics = [
    { messageId: 1, metric: 'views', value: 40, measuredAt: at(49 * H - 10 * 60_000) }, // ≈ 1 ч
    { messageId: 1, metric: 'views', value: 90, measuredAt: at(44 * H) }, // 6 ч
    { messageId: 1, metric: 'views', value: 150, measuredAt: at(26 * H + 20 * 60_000) }, // ≈ 24 ч
    { messageId: 1, metric: 'views', value: 200, measuredAt: at(H) }, // 49 ч — дальше 30 мин от 48 ч
    { messageId: 1, metric: 'reactions', value: 10, measuredAt: at(H) },
    { messageId: 2, metric: 'reactions', value: 3, measuredAt: at(H) },
    { messageId: 3, metric: 'reactions', value: 2, measuredAt: at(H) },
  ];
  const subs = [{ value: 400, measuredAt: at(51 * H) }];
  const posts = buildPosts(messages, metrics, subs, now);

  it('точки «через N часов» берутся только рядом с отметкой', () => {
    const p = posts.find((x) => x.key === 'm:1')!;
    expect(p.viewsAt).toEqual({ h1: 40, h6: 90, h24: 150, h48: null });
    expect(p.views).toBe(200);
    expect(p.reachPct).toBe(50);
    expect(p.reactionRatePct).toBe(5);
  });

  it('альбом — один пост, реакции суммируются; будущие точки — null', () => {
    const a = posts.find((x) => x.key === 'g:g')!;
    expect(a.kind).toBe('album');
    expect(a.reactions).toBe(5);
    expect(a.viewsAt.h6).toBeNull();
    expect(a.views).toBeNull();
  });

  it('сводка: среднее только по постам с данными', () => {
    const { reach, engagement } = reachSummary(posts);
    expect(reach.avgViews).toBe(200);
    expect(reach.postsWithViews).toBe(1);
    expect(engagement.avgReactions).toBe(7.5);
    expect(engagement.reactionRatePct).toBe(5);
  });
});

describe('эффективность', () => {
  it('план/факт, частота без выводов при малой выборке, типы и рубрики', () => {
    const posts = buildPosts(
      [
        msg(1, 24 * H, { hashtags: ['кофе'], publicationId: 'a' }),
        msg(2, 48 * H, { hashtags: ['кофе'], contentKind: 'photo' }),
      ],
      [],
      [],
      now,
    );
    const e = effectiveness(
      posts,
      [
        {
          status: 'published',
          scheduledAt: at(24 * H),
          publishedAt: at(24 * H - 2 * 60_000),
          createdAt: at(30 * H),
        },
        {
          status: 'published',
          scheduledAt: at(10 * H),
          publishedAt: at(10 * H - 20 * 60_000),
          createdAt: at(11 * H),
        },
        { status: 'failed', scheduledAt: at(5 * H), publishedAt: null, createdAt: at(6 * H) },
        {
          status: 'published',
          scheduledAt: at(3 * H),
          publishedAt: at(3 * H),
          createdAt: at(3 * H),
        },
      ],
      'Europe/Moscow',
      30,
    );
    expect(e.schedule).toMatchObject({
      planned: 3,
      onTime: 1,
      late: 1,
      failed: 1,
      immediate: 1,
      outsideApp: 1,
    });
    expect(e.frequency.recommendation).toBeNull();
    expect(e.types.map((t) => t.key).sort()).toEqual(['photo', 'text']);
    expect(e.rubrics).toEqual([expect.objectContaining({ key: 'кофе', posts: 2, enough: false })]);
  });
});

describe('реклама', () => {
  it('рекламные посты отдельно и сравнение со средним', () => {
    const posts = buildPosts(
      [msg(1, 10 * H, { isAd: true }), msg(2, 20 * H)],
      [
        { messageId: 1, metric: 'views', value: 300, measuredAt: at(H) },
        { messageId: 2, metric: 'views', value: 100, measuredAt: at(H) },
      ],
      [
        { value: 1000, measuredAt: at(21 * H) },
        { value: 1000, measuredAt: at(11 * H) },
      ],
      now,
    );
    expect(adsSummary(posts)).toMatchObject({
      count: 1,
      avgViews: 300,
      avgReachPct: 30,
      regularAvgViews: 100,
    });
  });
});
