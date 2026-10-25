'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { useSystemInfo } from '../system/use-system-info';
import { AddBotSteps } from './add-bot-steps';
import { ChannelCard } from './channel-card';
import { ConnectForm } from './connect-form';
import { groupChannels, type Channel } from './types';

type Load =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: Channel[] };

export function ChannelsScreen() {
  const t = useTranslations('channels');
  const info = useSystemInfo();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: Channel[] }>('/channels')
      .then((r) => !cancelled && setLoad({ kind: 'ready', items: r.items }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setLoad({ kind: 'error', message: e instanceof ApiError ? e.message : t('loadFailed') }),
      );
    return () => {
      cancelled = true;
    };
  }, [reload, t]);

  function upsert(c: Channel) {
    setLoad((prev) =>
      prev.kind === 'ready'
        ? {
            kind: 'ready',
            items: [...prev.items.filter((x) => x.id !== c.id), c].sort((a, b) =>
              a.title.localeCompare(b.title, 'ru'),
            ),
          }
        : { kind: 'ready', items: [c] },
    );
  }

  const groups = load.kind === 'ready' ? groupChannels(load.items) : null;
  const empty = groups !== null && load.kind === 'ready' && load.items.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1.5 max-w-prose text-sm text-text-muted">{t('intro')}</p>
      </header>

      <ConnectForm onConnected={upsert} />
      <AddBotSteps botUsername={info?.botUsername ?? null} defaultOpen={empty} />

      {load.kind === 'loading' && (
        <p className="text-sm text-text-muted" aria-busy="true">
          {t('loading')}
        </p>
      )}

      {load.kind === 'error' && (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-danger/30 bg-danger-soft px-4 py-3 text-sm"
        >
          <p className="text-danger">{load.message}</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ kind: 'loading' });
              setReload((n) => n + 1);
            }}
            className="mt-2 text-text underline underline-offset-4"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {empty && <p className="text-sm leading-relaxed text-text-muted">{t('empty')}</p>}

      {groups && groups.detected.length > 0 && (
        <Group title={t('groups.detected')} items={groups.detected} onChange={upsert} />
      )}
      {groups && groups.connected.length > 0 && (
        <Group title={t('groups.connected')} items={groups.connected} onChange={upsert} />
      )}
      {groups && groups.disconnected.length > 0 && (
        <Group title={t('groups.disconnected')} items={groups.disconnected} onChange={upsert} />
      )}
    </div>
  );
}

function Group({
  title,
  items,
  onChange,
}: {
  title: string;
  items: Channel[];
  onChange: (c: Channel) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-text-muted">
        {title} <span className="text-text-faint">{items.length}</span>
      </h2>
      {items.map((c) => (
        <ChannelCard key={c.id} channel={c} onChange={onChange} />
      ))}
    </section>
  );
}
