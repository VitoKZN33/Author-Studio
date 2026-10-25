'use client';

import { zonedDayKey, zonedWallTimeToUtc } from '@author-studio/shared';
import Link from 'next/link';
import { Icon } from '@/shared/ui/icons';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import type { Channel } from '../channels/types';
import {
  STATUS_DOT,
  STATUS_TONE,
  type PublicationStatus,
  type PublicationView,
} from '../posts/types';
import { useSystemInfo } from '../system/use-system-info';

const pad = (n: number) => String(n).padStart(2, '0');

/** Сетка месяца (с понедельника) в часовом поясе установки. */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days: string[] = [];
  for (let i = -lead; days.length < 42; i++) {
    const d = new Date(Date.UTC(year, month - 1, 1 + i));
    days.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  // Убираем последнюю неделю, если она целиком из следующего месяца.
  return days.slice(35).every((d) => d.slice(5, 7) !== pad(month)) ? days.slice(0, 35) : days;
}

const STATUS_FILTERS: (PublicationStatus | 'all')[] = [
  'all',
  'scheduled',
  'published',
  'failed',
  'ambiguous',
];

export function CalendarScreen() {
  const t = useTranslations('calendar');
  const tp = useTranslations('publications');
  const format = useFormatter();
  const info = useSystemInfo();
  const tz = info?.timezone ?? 'Europe/Moscow';
  const todayKey = zonedDayKey(new Date(), tz);
  const [ym, setYm] = useState(() => ({
    y: Number(todayKey.slice(0, 4)),
    m: Number(todayKey.slice(5, 7)),
  }));
  const [items, setItems] = useState<PublicationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState('');
  const [status, setStatus] = useState<PublicationStatus | 'all'>('all');
  const [selected, setSelected] = useState<string>(todayKey);

  const days = useMemo(() => monthGrid(ym.y, ym.m), [ym]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: Channel[] }>('/channels')
      .then((r) => !cancelled && setChannels(r.items.filter((c) => c.status !== 'detected')))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!info) return;
    let cancelled = false;
    const from = zonedWallTimeToUtc(`${days[0]}T00:00`, tz).toISOString();
    const last = new Date(`${days.at(-1)}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() + 1);
    const to = zonedWallTimeToUtc(`${last.toISOString().slice(0, 10)}T00:00`, tz).toISOString();
    const qs = new URLSearchParams({ from, to });
    if (channelId) qs.set('channelId', channelId);
    if (status !== 'all') qs.set('status', status);
    api
      .get<{ items: PublicationView[] }>(`/publications?${qs}`)
      .then(
        (r) =>
          !cancelled && (setItems(r.items.filter((i) => i.status !== 'cancelled')), setError(null)),
      )
      .catch(
        (e: unknown) => !cancelled && setError(e instanceof ApiError ? e.message : t('loadFailed')),
      );
    return () => {
      cancelled = true;
    };
  }, [days, tz, info, channelId, status, t]);

  const byDay = useMemo(() => {
    const map = new Map<string, PublicationView[]>();
    for (const p of items ?? []) {
      const key = zonedDayKey(new Date(p.publishedAt ?? p.scheduledAt), tz);
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [items, tz]);

  const shift = (delta: number) =>
    setYm(({ y, m }) => {
      const d = new Date(Date.UTC(y, m - 1 + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
    });

  const monthTitle = format.dateTime(new Date(Date.UTC(ym.y, ym.m - 1, 15)), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const timeOf = (p: PublicationView) =>
    format.dateTime(new Date(p.publishedAt ?? p.scheduledAt), {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    format.dateTime(new Date(Date.UTC(2026, 0, 5 + i)), { weekday: 'short', timeZone: 'UTC' }),
  );
  const dayItems = byDay.get(selected) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/posts/"
        className="-mb-2 flex items-center gap-0.5 text-sm font-semibold text-accent"
      >
        <Icon name="back" size={18} />
        {t('back')}
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-tight first-letter:uppercase">
          {monthTitle}
        </h1>
        <div className="flex gap-1.5">
          <NavBtn label={t('prev')} onClick={() => shift(-1)}>
            ‹
          </NavBtn>
          <button
            type="button"
            onClick={() => (
              setYm({ y: Number(todayKey.slice(0, 4)), m: Number(todayKey.slice(5, 7)) }),
              setSelected(todayKey)
            )}
            className="min-h-9 rounded-full border border-border bg-surface px-3 text-sm font-semibold"
          >
            {t('today')}
          </button>
          <NavBtn label={t('next')} onClick={() => shift(1)}>
            ›
          </NavBtn>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          aria-label={t('channel')}
          className="min-h-9 rounded-full border border-border bg-surface px-3 text-sm font-semibold"
        >
          <option value="">{t('allChannels')}</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as PublicationStatus | 'all')}
          aria-label={t('status')}
          className="min-h-9 rounded-full border border-border bg-surface px-3 text-sm font-semibold"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? t('allStatuses') : tp(`status.${s}`)}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-text-faint">{t('tz', { tz })}</span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-2">
        <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-text-faint">
          {weekdays.map((w) => (
            <div key={w} className="py-1.5">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const inMonth = Number(d.slice(5, 7)) === ym.m;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSelected(d)}
                aria-pressed={selected === d}
                aria-label={t('dayLabel', { day: Number(d.slice(8)), count: list.length })}
                className={`flex min-h-12 flex-col items-center gap-1 rounded-[10px] p-1 md:min-h-24 md:items-stretch md:text-left ${selected === d ? 'bg-accent-soft ring-2 ring-accent ring-inset' : list.length ? 'bg-surface-2' : ''}`}
              >
                <span
                  className={`grid size-7 place-items-center rounded-full text-[13px] font-semibold ${d === todayKey ? 'bg-ink text-on-ink' : inMonth ? 'text-text' : 'text-text-faint/60'}`}
                >
                  {Number(d.slice(8))}
                </span>
                <span className="hidden flex-col gap-0.5 md:flex">
                  {list.slice(0, 3).map((p) => (
                    <span
                      key={p.id}
                      className={`truncate rounded px-1 py-0.5 text-[11px] ${STATUS_TONE[p.status]}`}
                    >
                      {timeOf(p)} {p.summary}
                    </span>
                  ))}
                  {list.length > 3 && (
                    <span className="text-[11px] text-text-faint">+{list.length - 3}</span>
                  )}
                </span>
                {list.length > 0 && (
                  <span className="flex flex-wrap justify-center gap-0.5 md:hidden">
                    {list.slice(0, 4).map((p) => (
                      <span
                        key={p.id}
                        className={`size-1.5 rounded-full ${STATUS_DOT[p.status]}`}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="px-0.5 text-[15px] font-bold first-letter:uppercase">
          {format.dateTime(new Date(`${selected}T12:00:00Z`), {
            day: 'numeric',
            month: 'long',
            weekday: 'long',
            timeZone: 'UTC',
          })}
        </h2>
        {dayItems.length === 0 ? (
          <p className="text-sm text-text-faint">{t('emptyDay')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            {dayItems.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/posts/edit/?id=${p.postId}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2"
                >
                  <span className="w-11 shrink-0 text-sm text-text-muted">{timeOf(p)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{p.summary}</span>
                    <span className="block truncate text-xs text-text-faint">{p.channelTitle}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[p.status]}`}
                  >
                    {tp(`status.${p.status}`)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NavBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full border border-border bg-surface text-lg"
    >
      {children}
    </button>
  );
}
