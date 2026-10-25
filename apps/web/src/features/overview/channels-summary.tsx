'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/shared/api';
import type { Channel } from '../channels/types';

/** Короткая сводка по каналам на главной: что работает и что требует внимания. */
export function ChannelsSummary() {
  const t = useTranslations('overview.channels');
  const [items, setItems] = useState<Channel[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: Channel[] }>('/channels')
      .then((r) => !cancelled && setItems(r.items))
      .catch(() => !cancelled && setItems(null));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items) return null;
  const active = items.filter((c) => c.status === 'active').length;
  const attention = items.filter(
    (c) => c.status === 'rights_missing' || c.status === 'bot_removed' || c.status === 'detected',
  ).length;

  return (
    <Link
      href="/channels/"
      className="block rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4 hover:border-border-strong"
    >
      <h2 className="text-sm font-medium">{t('title')}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {items.length === 0 ? t('none') : t('counts', { active, attention })}
      </p>
      {attention > 0 && <p className="mt-2 text-sm text-warn">{t('attention')}</p>}
    </Link>
  );
}
