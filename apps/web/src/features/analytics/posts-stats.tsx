'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/shared/api';
import { haptic } from '@/shared/telegram';
import { signed, type MetricValue, type PostStats } from './types';
import { KindTag } from './value-kind';

interface Props {
  channelId: string;
  items: PostStats[];
  timezone: string;
  sort: 'date' | 'reactions' | 'views';
  onSort: (s: 'date' | 'reactions' | 'views') => void;
  onChanged: () => void;
}

export function PostsStats({ channelId, items, timezone, sort, onSort, onChanged }: Props) {
  const t = useTranslations('analytics.posts');
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">{t('title')}</h2>
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as Props['sort'])}
          aria-label={t('sort')}
          className="min-h-9 rounded-full border border-border bg-surface px-3 text-sm font-semibold"
        >
          {(['date', 'reactions', 'views'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`sortBy.${s}`)}
            </option>
          ))}
        </select>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-text-faint">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((p) => (
            <PostCard
              key={p.key}
              p={p}
              channelId={channelId}
              timezone={timezone}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PostCard({
  p,
  channelId,
  timezone,
  onChanged,
}: {
  p: PostStats;
  channelId: string;
  timezone: string;
  onChanged: () => void;
}) {
  const t = useTranslations('analytics.posts');
  const format = useFormatter();
  const [editing, setEditing] = useState(false);
  const [views, setViews] = useState(p.views ? String(p.views.value) : '');
  const [forwards, setForwards] = useState(p.forwards ? String(p.forwards.value) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  async function save(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, number> = { messageId: p.primaryMessageId };
    if (views.trim()) body.views = Number(views);
    if (forwards.trim()) body.forwards = Number(forwards);
    if (Object.values(body).some((v) => !Number.isInteger(v) || v < 0)) {
      setError(t('invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/analytics/channels/${channelId}/manual`, body);
      haptic('success');
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  const metric = (label: string, v: MetricValue | null, kind: 'fact' | 'manual') => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-text-faint">{label}</dt>
      <dd className="flex items-center gap-1.5">
        {v ? (
          <>
            <span className="text-[15px] tabular-nums">{format.number(v.value)}</span>
            <KindTag kind={kind} />
          </>
        ) : (
          <KindTag kind="none" />
        )}
      </dd>
    </div>
  );

  return (
    <li className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-[15px] font-semibold">{p.summary}</p>
        <span className="shrink-0 text-xs text-text-faint">{when(p.postedAt)}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {metric(t('reactions'), p.reactions, 'fact')}
        {metric(t('views'), p.views, 'manual')}
        {metric(t('forwards'), p.forwards, 'manual')}
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-text-faint">{t('err')}</dt>
          <dd className="flex items-center gap-1.5" title={t('errFormula')}>
            {p.err !== null ? (
              <>
                <span className="text-[15px] tabular-nums">{p.err}%</span>
                <KindTag kind="estimate" />
              </>
            ) : (
              <KindTag kind="none" />
            )}
          </dd>
        </div>
      </dl>
      {p.change24h && (
        <p className="mt-3 text-xs leading-relaxed text-text-muted">
          {t('change24h', {
            delta: signed(p.change24h.delta),
            before: p.change24h.before,
            after: p.change24h.after,
          })}
          {p.change24h.baselinePerDay !== null &&
            ` ${t('baseline', { value: signed(p.change24h.baselinePerDay) })}`}{' '}
          <span className="text-text-faint">{t('notCausal')}</span>
        </p>
      )}
      {editing ? (
        <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {t('views')}
            <input
              inputMode="numeric"
              value={views}
              onChange={(e) => setViews(e.target.value.replace(/\D/g, ''))}
              className="min-h-10 w-28 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-text"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {t('forwards')}
            <input
              inputMode="numeric"
              value={forwards}
              onChange={(e) => setForwards(e.target.value.replace(/\D/g, ''))}
              className="min-h-10 w-28 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-text"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="min-h-10 rounded-[var(--radius-control)] bg-accent px-3.5 text-sm font-medium text-on-accent disabled:opacity-50"
          >
            {t('save')}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="min-h-10 px-2 text-sm text-text-muted"
          >
            {t('cancel')}
          </button>
          <p className="basis-full text-xs text-text-faint">{t('manualHint')}</p>
          {error && (
            <p role="alert" className="basis-full text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 text-sm text-accent underline underline-offset-4"
        >
          {p.views ? t('updateManual') : t('enterManual')}
        </button>
      )}
    </li>
  );
}
