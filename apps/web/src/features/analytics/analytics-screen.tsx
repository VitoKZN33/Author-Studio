'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { zonedDayKey } from '@author-studio/shared';
import { api, ApiError } from '@/shared/api';
import { haptic } from '@/shared/telegram';
import type { Channel } from '../channels/types';
import { BestTimeGrid } from './best-time';
import { MembersChart, SeriesTable, SubscribersChart } from './charts';
import { PostsStats } from './posts-stats';
import { signed, type BestTime, type Overview, type PostStats } from './types';
import { KindLegend, KindTag } from './value-kind';

type Days = 7 | 30 | 90;

export function AnalyticsScreen() {
  const t = useTranslations('analytics');
  const format = useFormatter();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [channelId, setChannelId] = useState('');
  const [days, setDays] = useState<Days>(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [posts, setPosts] = useState<PostStats[]>([]);
  const [sort, setSort] = useState<'date' | 'reactions' | 'views'>('date');
  const [best, setBest] = useState<BestTime | null>(null);
  const [metric, setMetric] = useState<'reactions' | 'views'>('reactions');
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [tableView, setTableView] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: Channel[] }>('/channels')
      .then((r) => {
        if (cancelled) return;
        const list = r.items.filter((c) => c.status !== 'detected' && c.status !== 'disconnected');
        setChannels(list);
        setChannelId((cur) => cur || list[0]?.id || '');
      })
      .catch(() => !cancelled && setChannels([]));
    return () => {
      cancelled = true;
    };
  }, []);

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
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-text-muted">
          {t('noChannels')}{' '}
          <Link href="/channels/" className="text-accent underline underline-offset-4">
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
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="flex flex-wrap gap-2">
          {channels && channels.length > 1 && (
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              aria-label={t('channel')}
              className="min-h-9 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-2 text-sm"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
          <div
            className="grid grid-cols-3 gap-1 rounded-[var(--radius-control)] bg-surface-2 p-1"
            role="radiogroup"
            aria-label={t('period')}
          >
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={days === d}
                onClick={() => setDays(d)}
                className={`min-h-8 rounded-[6px] px-3 text-sm ${days === d ? 'bg-surface text-text' : 'text-text-muted'}`}
              >
                {t('days', { d })}
              </button>
            ))}
          </div>
        </div>
      </header>

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

      {overview && (
        <>
          <p className="max-w-prose text-xs leading-relaxed text-text-faint">
            {since
              ? t('coverage', { since: dateFmt(since), every: overview.coverage.intervalMinutes })
              : t('coverageNone')}{' '}
            {t('limits')}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label={t('cards.current')}
              value={overview.current ? format.number(overview.current.value) : null}
              kind="fact"
              note={
                overview.current
                  ? t('cards.measuredAt', {
                      when: format.relativeTime(new Date(overview.current.measuredAt)),
                    })
                  : t('cards.noCurrent')
              }
            />
            <StatCard
              label={t('cards.change', { d: days })}
              value={overview.periodChange ? signed(overview.periodChange.delta) : null}
              kind="measured"
              note={
                overview.periodChange
                  ? t('cards.changeNote', {
                      from: overview.periodChange.from,
                      to: overview.periodChange.to,
                    })
                  : t('cards.notEnough')
              }
            />
            <StatCard
              label={t('cards.members')}
              value={
                overview.joinsTotal !== null
                  ? `+${overview.joinsTotal} / −${overview.leavesTotal ?? 0}`
                  : null
              }
              kind="fact"
              note={overview.joinsTotal !== null ? t('cards.membersNote') : t('cards.noEvents')}
            />
          </div>

          <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium">{t('chart.subscribersTitle')}</h2>
              <button
                type="button"
                onClick={() => setTableView((v) => !v)}
                className="text-xs text-text-muted underline underline-offset-4"
              >
                {tableView ? t('chart.showChart') : t('chart.showTable')}
              </button>
            </div>
            {tableView ? (
              <SeriesTable series={overview.series} />
            ) : (
              <SubscribersChart series={overview.series} postsByDay={postsByDay} />
            )}
            {!tableView && <p className="text-xs text-text-faint">{t('chart.markersHint')}</p>}
          </section>

          {!tableView && overview.series.some((p) => p.joins !== null) && (
            <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <h2 className="text-sm font-medium">{t('chart.membersTitle')}</h2>
              <MembersChart series={overview.series} />
              <p className="text-xs text-text-faint">{t('chart.membersHint')}</p>
            </section>
          )}

          <KindLegend />

          <PostsStats
            channelId={channelId}
            items={posts}
            timezone={overview.timezone}
            sort={sort}
            onSort={setSort}
            onChanged={() => setReload((n) => n + 1)}
          />

          {best && <BestTimeGrid data={best} onMetric={setMetric} />}

          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={exportState === 'busy'}
              className="min-h-10 self-start rounded-[var(--radius-control)] border border-border-strong px-3.5 text-sm text-text-muted hover:text-text disabled:opacity-50"
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
    </div>
  );
}

function StatCard({
  label,
  value,
  kind,
  note,
}: {
  label: string;
  value: string | null;
  kind: 'fact' | 'measured';
  note: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">{label}</span>
        <KindTag kind={value === null ? 'none' : kind} />
      </div>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value ?? '—'}</span>
      <span className="text-xs text-text-faint">{note}</span>
    </div>
  );
}
