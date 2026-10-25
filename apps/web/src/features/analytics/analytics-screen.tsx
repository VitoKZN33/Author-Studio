'use client';

import { zonedDayKey } from '@author-studio/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { haptic } from '@/shared/telegram';
import { btn, PageHeader, Segmented } from '@/shared/ui/kit';
import { ChannelChip } from '../channels/channel-chip';
import { useChannels } from '../channels/use-channels';
import { BestTimeGrid } from './best-time';
import { MembersChart, SeriesTable, SubscribersChart } from './charts';
import { PostsStats } from './posts-stats';
import { signed, type BestTime, type Overview, type PostStats } from './types';
import { KindLegend, KindTag } from './value-kind';

type Days = 7 | 30 | 90;
type Tab = 'overview' | 'posts' | 'time';
const TABS: Tab[] = ['overview', 'posts', 'time'];

export function AnalyticsScreen() {
  const t = useTranslations('analytics');
  const format = useFormatter();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'overview';
  const { channels, selected: channelId, select } = useChannels();
  const [days, setDays] = useState<Days>(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [posts, setPosts] = useState<PostStats[]>([]);
  const [sort, setSort] = useState<'date' | 'reactions' | 'views'>('reactions');
  const [best, setBest] = useState<BestTime | null>(null);
  const [metric, setMetric] = useState<'reactions' | 'views'>('reactions');
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [tableView, setTableView] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    const base = `/analytics/channels/${channelId}`;
    Promise.all([
      api.get<Overview>(`${base}/overview?days=${days}`),
      api.get<{ items: PostStats[] }>(`${base}/posts?days=${days}&sort=${sort}`),
    ])
      .then(([o, p]) => {
        if (cancelled) return;
        setOverview(o);
        setPosts(p.items);
        setError(null);
      })
      .catch(
        (e: unknown) => !cancelled && setError(e instanceof ApiError ? e.message : t('loadFailed')),
      );
    return () => {
      cancelled = true;
    };
  }, [channelId, days, sort, reload, t]);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    api
      .get<BestTime>(`/analytics/channels/${channelId}/best-time?days=90&metric=${metric}`)
      .then((b) => !cancelled && setBest(b))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [channelId, metric, reload]);

  const postsByDay = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!overview) return m;
    for (const p of overview.markers) {
      const k = zonedDayKey(new Date(p.postedAt), overview.timezone);
      m.set(k, [...(m.get(k) ?? []), p.summary]);
    }
    return m;
  }, [overview]);

  const errs = posts.map((p) => p.err).filter((x): x is number => x !== null);
  const avgErr = errs.length
    ? Math.round((errs.reduce((s, x) => s + x, 0) / errs.length) * 10) / 10
    : null;

  async function exportCsv() {
    setExportState('busy');
    try {
      await api.post(`/analytics/channels/${channelId}/export?days=${days}`);
      haptic('success');
      setExportState('sent');
    } catch {
      setExportState('error');
    }
  }

  if (channels && channels.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title={t('title')} />
        <p className="text-sm text-text-muted">
          {t('noChannels')}{' '}
          <Link href="/channels/" className={btn.link}>
            {t('toChannels')}
          </Link>
        </p>
      </div>
    );
  }

  const since = overview?.coverage.subscribersSince;
  const dateFmt = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: overview?.timezone,
    });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('title')}
        right={
          channels && <ChannelChip channels={channels} selected={channelId} onSelect={select} />
        }
      />
      <Segmented
        label={t('sections')}
        value={tab}
        onChange={(v) => router.replace(`/analytics/?tab=${v}`)}
        options={TABS.map((k) => ({ value: k, label: t(`tabs.${k}`) }))}
      />

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {!overview && !error && (
        <p className="text-sm text-text-muted" aria-busy="true">
          {t('loading')}
        </p>
      )}

      {overview && tab === 'overview' && (
        <>
          <Segmented
            label={t('period')}
            value={days}
            onChange={setDays}
            options={([7, 30, 90] as const).map((d) => ({ value: d, label: t('daysLong', { d }) }))}
          />

          <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-bold">{t('chart.subscribersTitle')}</h2>
              <KindTag kind={overview.current ? 'fact' : 'none'} />
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <b className="text-[40px] leading-none font-extrabold tracking-tight tabular-nums">
                {overview.current ? format.number(overview.current.value) : '—'}
              </b>
              {overview.periodChange && (
                <span
                  className={`font-bold ${overview.periodChange.delta > 0 ? 'text-ok' : overview.periodChange.delta < 0 ? 'text-danger' : 'text-text-muted'}`}
                >
                  {t('changeFor', { delta: signed(overview.periodChange.delta), d: days })}
                </span>
              )}
            </div>
            <p className="text-xs text-text-faint">
              {overview.current
                ? t('cards.measuredAt', {
                    when: format.relativeTime(new Date(overview.current.measuredAt)),
                  })
                : t('cards.noCurrent')}
              {!overview.periodChange && overview.current ? `. ${t('cards.notEnough')}` : ''}
            </p>
            {tableView ? (
              <SeriesTable series={overview.series} />
            ) : (
              <SubscribersChart series={overview.series} postsByDay={postsByDay} />
            )}
            <div className="flex items-start justify-between gap-3">
              {!tableView && <p className="text-xs text-text-faint">{t('chart.markersHint')}</p>}
              <button
                type="button"
                onClick={() => setTableView((v) => !v)}
                className="ml-auto shrink-0 text-xs font-semibold text-accent"
              >
                {tableView ? t('chart.showChart') : t('chart.showTable')}
              </button>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-2.5">
            <Tile
              kind={overview.joinsTotal !== null ? 'fact' : 'none'}
              value={
                overview.joinsTotal !== null
                  ? `+${overview.joinsTotal} / −${overview.leavesTotal ?? 0}`
                  : '—'
              }
              label={overview.joinsTotal !== null ? t('cards.members') : t('cards.noEventsShort')}
            />
            <Tile
              kind={avgErr !== null ? 'estimate' : 'none'}
              value={avgErr !== null ? `${String(avgErr).replace('.', ',')}%` : '—'}
              label={avgErr !== null ? t('cards.avgErr', { n: errs.length }) : t('cards.noErr')}
            />
          </div>

          {overview.series.some((p) => p.joins !== null) && (
            <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <h2 className="text-[15px] font-bold">{t('chart.membersTitle')}</h2>
              <MembersChart series={overview.series} />
              <p className="text-xs text-text-faint">{t('chart.membersHint')}</p>
            </section>
          )}

          <Link
            href="/ai/?tab=review"
            className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-ink px-4 py-4 text-on-ink"
          >
            <span className="min-w-0">
              <span className="block font-bold">{t('ai.title')}</span>
              <span className="block text-[13px] opacity-70">{t('ai.text')}</span>
            </span>
            <span className="shrink-0 rounded-full bg-accent px-3.5 py-2 text-sm font-bold text-on-accent">
              {t('ai.action')}
            </span>
          </Link>

          <p className="text-xs leading-relaxed text-text-faint">
            {since
              ? t('coverage', { since: dateFmt(since), every: overview.coverage.intervalMinutes })
              : t('coverageNone')}{' '}
            {t('limits')}
          </p>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={exportState === 'busy'}
              className={`${btn.outline} self-start text-sm`}
            >
              {exportState === 'busy' ? t('export.busy') : t('export.button', { d: days })}
            </button>
            {exportState === 'sent' && <p className="text-xs text-ok">{t('export.sent')}</p>}
            {exportState === 'error' && (
              <p role="alert" className="text-xs text-danger">
                {t('export.failed')}
              </p>
            )}
          </div>
        </>
      )}

      {overview && tab === 'posts' && (
        <>
          <Segmented
            label={t('period')}
            value={days}
            onChange={setDays}
            options={([7, 30, 90] as const).map((d) => ({ value: d, label: t('daysLong', { d }) }))}
          />
          <PostsStats
            channelId={channelId}
            items={posts}
            timezone={overview.timezone}
            sort={sort}
            onSort={setSort}
            onChanged={() => setReload((n) => n + 1)}
          />
          <KindLegend />
        </>
      )}

      {tab === 'time' && best && <BestTimeGrid data={best} onMetric={setMetric} />}
    </div>
  );
}

function Tile({
  kind,
  value,
  label,
}: {
  kind: 'fact' | 'estimate' | 'none';
  value: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-[var(--radius-card)] border border-border bg-surface p-3.5">
      <KindTag kind={kind} />
      <b className="text-[22px] leading-tight font-extrabold tracking-tight tabular-nums">
        {value}
      </b>
      <span className="text-[12px] leading-snug text-text-faint">{label}</span>
    </div>
  );
}
