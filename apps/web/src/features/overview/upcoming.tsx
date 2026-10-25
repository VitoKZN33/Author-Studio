'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/shared/api';
import { STATUS_TONE, type PublicationView } from '../posts/types';
import { useSystemInfo } from '../system/use-system-info';

/** Ближайшие запланированные и требующие внимания отправки. */
export function Upcoming() {
  const t = useTranslations('overview.upcoming');
  const tp = useTranslations('publications');
  const format = useFormatter();
  const tz = useSystemInfo()?.timezone;
  const [items, setItems] = useState<PublicationView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const from = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const to = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    const qs = new URLSearchParams({ from, to, status: 'scheduled,failed,ambiguous' });
    api
      .get<{ items: PublicationView[] }>(`/publications?${qs}`)
      .then((r) => !cancelled && setItems(r.items))
      .catch(() => !cancelled && setItems(null));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items) return null;
  const attention = items.filter((p) => p.status !== 'scheduled');
  const next = items.filter((p) => p.status === 'scheduled').slice(0, 3);
  const list = [...attention, ...next];

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface">
      <header className="flex items-center justify-between gap-3 px-4 pt-4">
        <h2 className="text-sm font-medium">{t('title')}</h2>
        <Link href="/posts/" className="text-sm text-accent">
          {t('new')}
        </Link>
      </header>
      {list.length === 0 ? (
        <p className="px-4 pt-1 pb-4 text-sm text-text-muted">{t('none')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {list.map((p) => (
            <li key={p.id}>
              <Link
                href={`/posts/edit/?id=${p.postId}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"
              >
                <span className="w-24 shrink-0 text-xs text-text-muted">
                  {format.dateTime(new Date(p.scheduledAt), {
                    timeZone: tz,
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{p.summary}</span>
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
  );
}
