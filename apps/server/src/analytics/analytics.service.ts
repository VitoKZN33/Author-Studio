import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { DB, type Database } from '../database/database.module.js';
import {
  channelMemberEvents,
  channelMessages,
  channelMetricSnapshots,
  channels,
  messageMetricSnapshots,
} from '../database/schema.js';
import {
  bestTime,
  dailySeries,
  dayKeys,
  engagementRate,
  periodChange,
  valueAt,
  windowChange,
  type Snapshot,
} from './calc.js';

export type PostSort = 'date' | 'reactions' | 'views';

export interface MetricValue {
  value: number;
  measuredAt: string;
  source: 'telegram_api' | 'manual';
}

export interface PostStats {
  key: string;
  messageIds: number[];
  /** Сообщение, к которому привязан ручной ввод просмотров. */
  primaryMessageId: number;
  postedAt: string;
  summary: string;
  publicationId: string | null;
  reactions: MetricValue | null;
  views: MetricValue | null;
  forwards: MetricValue | null;
  subscribersAtPost: number | null;
  err: number | null;
  change24h: ReturnType<typeof windowChange>;
}

const DAY = 86_400_000;

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private tz() {
    return this.config.APP_TIMEZONE;
  }

  async channel(ownerId: string, channelId: string) {
    const [c] = await this.db
      .select()
      .from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.ownerId, ownerId)))
      .limit(1);
    if (!c) throw new NotFoundException('Канал не найден');
    return c;
  }

  private async subscriberSnapshots(
    channelId: string,
    from?: Date,
    to?: Date,
  ): Promise<Snapshot[]> {
    const where = [
      eq(channelMetricSnapshots.channelId, channelId),
      eq(channelMetricSnapshots.metric, 'subscribers'),
    ];
    if (from) where.push(gte(channelMetricSnapshots.measuredAt, from));
    if (to) where.push(lte(channelMetricSnapshots.measuredAt, to));
    const rows = await this.db
      .select({
        value: channelMetricSnapshots.value,
        measuredAt: channelMetricSnapshots.measuredAt,
      })
      .from(channelMetricSnapshots)
      .where(and(...where))
      .orderBy(asc(channelMetricSnapshots.measuredAt));
    return rows;
  }

  async overview(ownerId: string, channelId: string, days: number) {
    const c = await this.channel(ownerId, channelId);
    const now = new Date();
    const from = new Date(now.getTime() - (days - 1) * DAY);
    const keys = dayKeys(from, now, this.tz());

    // Снимки с запасом в 2 дня до периода — для изменения в первый день.
    const snaps = await this.subscriberSnapshots(c.id, new Date(from.getTime() - 2 * DAY), now);
    const [first] = await this.db
      .select({ measuredAt: channelMetricSnapshots.measuredAt })
      .from(channelMetricSnapshots)
      .where(
        and(
          eq(channelMetricSnapshots.channelId, c.id),
          eq(channelMetricSnapshots.metric, 'subscribers'),
        ),
      )
      .orderBy(asc(channelMetricSnapshots.measuredAt))
      .limit(1);
    const [firstEvent] = await this.db
      .select({ occurredAt: channelMemberEvents.occurredAt })
      .from(channelMemberEvents)
      .where(eq(channelMemberEvents.channelId, c.id))
      .orderBy(asc(channelMemberEvents.occurredAt))
      .limit(1);
    const events = await this.db
      .select({ kind: channelMemberEvents.kind, occurredAt: channelMemberEvents.occurredAt })
      .from(channelMemberEvents)
      .where(
        and(eq(channelMemberEvents.channelId, c.id), gte(channelMemberEvents.occurredAt, from)),
      );
    const posts = await this.db
      .select({
        postedAt: channelMessages.postedAt,
        summary: channelMessages.summary,
        publicationId: channelMessages.publicationId,
        mediaGroupId: channelMessages.mediaGroupId,
        messageId: channelMessages.messageId,
      })
      .from(channelMessages)
      .where(and(eq(channelMessages.channelId, c.id), gte(channelMessages.postedAt, from)))
      .orderBy(asc(channelMessages.postedAt));

    const series = dailySeries(snaps, events, keys, this.tz(), firstEvent?.occurredAt ?? null);
    const latest = snaps.at(-1) ?? null;
    const seen = new Set<string>();
    const markers = posts
      .filter((p) => {
        const k = p.publicationId ?? p.mediaGroupId ?? String(p.messageId);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((p) => ({ postedAt: p.postedAt.toISOString(), summary: p.summary }));

    return {
      channel: { id: c.id, title: c.title, username: c.username, status: c.status },
      timezone: this.tz(),
      current: latest ? { value: latest.value, measuredAt: latest.measuredAt.toISOString() } : null,
      periodChange: periodChange(series),
      joinsTotal: series.some((p) => p.joins !== null)
        ? series.reduce((s, p) => s + (p.joins ?? 0), 0)
        : null,
      leavesTotal: series.some((p) => p.leaves !== null)
        ? series.reduce((s, p) => s + (p.leaves ?? 0), 0)
        : null,
      series,
      markers,
      coverage: {
        subscribersSince: first?.measuredAt.toISOString() ?? null,
        memberEventsSince: firstEvent?.occurredAt.toISOString() ?? null,
        intervalMinutes: this.config.METRICS_SUBSCRIBERS_INTERVAL_MINUTES,
      },
    };
  }

  private async latestMetrics(channelId: string, messageIds: number[]) {
    if (messageIds.length === 0) return new Map<string, MetricValue>();
    const rows = await this.db
      .select()
      .from(messageMetricSnapshots)
      .where(
        and(
          eq(messageMetricSnapshots.channelId, channelId),
          inArray(messageMetricSnapshots.messageId, messageIds),
        ),
      )
      .orderBy(desc(messageMetricSnapshots.measuredAt), desc(messageMetricSnapshots.id));
    const map = new Map<string, MetricValue>();
    for (const r of rows) {
      const key = `${r.messageId}:${r.metric}`;
      if (!map.has(key))
        map.set(key, { value: r.value, measuredAt: r.measuredAt.toISOString(), source: r.source });
    }
    return map;
  }

  async posts(
    ownerId: string,
    channelId: string,
    days: number,
    sort: PostSort = 'date',
  ): Promise<PostStats[]> {
    const c = await this.channel(ownerId, channelId);
    const now = new Date();
    const from = new Date(now.getTime() - days * DAY);
    const msgs = await this.db
      .select()
      .from(channelMessages)
      .where(and(eq(channelMessages.channelId, c.id), gte(channelMessages.postedAt, from)))
      .orderBy(asc(channelMessages.postedAt), asc(channelMessages.messageId));

    const groups = new Map<string, typeof msgs>();
    for (const m of msgs) {
      const key = m.publicationId
        ? `p:${m.publicationId}`
        : m.mediaGroupId
          ? `g:${m.mediaGroupId}`
          : `m:${m.messageId}`;
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    const metrics = await this.latestMetrics(
      c.id,
      msgs.map((m) => m.messageId),
    );
    const snaps = await this.subscriberSnapshots(c.id, new Date(from.getTime() - 8 * DAY), now);

    const result: PostStats[] = [...groups.entries()].map(([key, list]) => {
      const primary = list[0]!;
      const ids = list.map((m) => m.messageId);
      // Реакции в альбоме могут быть на разных сообщениях — суммируем последние значения.
      const reactionParts = ids
        .map((id) => metrics.get(`${id}:reactions`))
        .filter((x): x is MetricValue => !!x);
      const reactions = reactionParts.length
        ? {
            value: reactionParts.reduce((s, r) => s + r.value, 0),
            measuredAt: reactionParts
              .map((r) => r.measuredAt)
              .sort()
              .at(-1)!,
            source: 'telegram_api' as const,
          }
        : null;
      const views = metrics.get(`${primary.messageId}:views`) ?? null;
      const forwards = metrics.get(`${primary.messageId}:forwards`) ?? null;
      const subs = valueAt(snaps, primary.postedAt, 6 * 3600_000)?.value ?? null;
      return {
        key,
        messageIds: ids,
        primaryMessageId: primary.messageId,
        postedAt: primary.postedAt.toISOString(),
        summary:
          list.find((m) => m.summary && m.summary !== 'Фото' && m.summary !== 'Видео')?.summary ??
          primary.summary,
        publicationId: primary.publicationId,
        reactions,
        views,
        forwards,
        subscribersAtPost: subs,
        err: engagementRate(views?.value ?? null, subs),
        change24h: windowChange(snaps, primary.postedAt, 24, now),
      };
    });

    const metricOf = (p: PostStats) =>
      (sort === 'views' ? p.views?.value : p.reactions?.value) ?? -1;
    return sort === 'date'
      ? result.sort((a, b) => b.postedAt.localeCompare(a.postedAt))
      : result.sort((a, b) => metricOf(b) - metricOf(a) || b.postedAt.localeCompare(a.postedAt));
  }

  async recordManual(
    ownerId: string,
    channelId: string,
    messageId: number,
    input: { views?: number; forwards?: number },
  ) {
    const c = await this.channel(ownerId, channelId);
    const [m] = await this.db
      .select({ id: channelMessages.id })
      .from(channelMessages)
      .where(and(eq(channelMessages.channelId, c.id), eq(channelMessages.messageId, messageId)))
      .limit(1);
    if (!m) throw new NotFoundException('Пост не найден в аналитике канала');
    const rows = (['views', 'forwards'] as const)
      .filter((k) => input[k] !== undefined)
      .map((k) => ({
        channelId: c.id,
        messageId,
        metric: k,
        value: input[k]!,
        source: 'manual' as const,
      }));
    if (rows.length === 0) throw new BadRequestException('Укажите просмотры или пересылки');
    await this.db.insert(messageMetricSnapshots).values(rows);
    await this.audit.record({
      action: 'analytics.manual',
      actorUserId: ownerId,
      entityType: 'channel',
      entityId: c.id,
      metadata: { messageId, ...input },
    });
  }

  async bestTime(ownerId: string, channelId: string, days: number, metric: 'reactions' | 'views') {
    const posts = await this.posts(ownerId, channelId, days, 'date');
    const sample = posts
      .filter((p) => (metric === 'views' ? p.views : p.reactions))
      .map((p) => ({
        postedAt: new Date(p.postedAt),
        value: (metric === 'views' ? p.views : p.reactions)!.value,
      }));
    return {
      metric,
      days,
      timezone: this.tz(),
      postsInPeriod: posts.length,
      ...bestTime(sample, this.tz()),
    };
  }

  async csv(ownerId: string, channelId: string, days: number): Promise<string> {
    const posts = await this.posts(ownerId, channelId, days, 'date');
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      // Защита от формул в табличных редакторах (=, +, -, @ в начале ячейки).
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const header = [
      'Дата (UTC)',
      'Пост',
      'Реакции',
      'Просмотры (вручную)',
      'Пересылки (вручную)',
      'Подписчиков при публикации',
      'ERR, %',
      'Изменение подписчиков за 24 ч (наблюдаемое)',
    ];
    const lines = posts.map((p) =>
      [
        p.postedAt,
        p.summary,
        p.reactions?.value,
        p.views?.value,
        p.forwards?.value,
        p.subscribersAtPost,
        p.err,
        p.change24h?.delta,
      ]
        .map(esc)
        .join(';'),
    );
    return '﻿' + [header.join(';'), ...lines].join('\r\n');
  }
}
