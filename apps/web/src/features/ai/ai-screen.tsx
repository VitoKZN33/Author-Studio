'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/shared/api';
import type { Channel } from '../channels/types';
import { AiSettingsForm } from './ai-settings-form';
import { PlanTab } from './plan-tab';
import { ReviewTab } from './review-tab';
import { aiReady } from './types';
import { useAiSettings } from './use-ai-settings';

const TABS = ['plan', 'review', 'settings'] as const;
type Tab = (typeof TABS)[number];

export function AiScreen() {
  const t = useTranslations('ai');
  const router = useRouter();
  const requested = useSearchParams().get('tab') as Tab | null;
  const { settings, setSettings, failed } = useAiSettings();
  const [channels, setChannels] = useState<Channel[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: Channel[] }>('/channels')
      .then(
        (r) =>
          !cancelled &&
          setChannels(
            r.items.filter((c) => c.status !== 'detected' && c.status !== 'disconnected'),
          ),
      )
      .catch(() => !cancelled && setChannels([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed)
    return (
      <p role="alert" className="text-sm text-danger">
        {t('loadFailed')}
      </p>
    );
  if (!settings || !channels)
    return (
      <p className="text-sm text-text-muted" aria-busy="true">
        {t('loading')}
      </p>
    );

  const ready = aiReady(settings);
  const tab: Tab = requested && TABS.includes(requested) ? requested : ready ? 'plan' : 'settings';

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <div
          className="grid grid-cols-3 gap-1 rounded-[var(--radius-control)] bg-surface-2 p-1"
          role="tablist"
        >
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => router.replace(`/ai/?tab=${k}`)}
              className={`min-h-9 rounded-[6px] text-sm ${tab === k ? 'bg-surface text-text' : 'text-text-muted'}`}
            >
              {t(`tabs.${k}`)}
            </button>
          ))}
        </div>
      </header>

      {!ready && tab !== 'settings' ? (
        <div className="flex flex-col gap-2 text-sm text-text-muted">
          <p>{settings.hasKey ? t('disabled') : t('notConfigured')}</p>
          <button
            type="button"
            onClick={() => router.replace('/ai/?tab=settings')}
            className="self-start text-accent underline underline-offset-4"
          >
            {t('toSettings')}
          </button>
        </div>
      ) : tab === 'plan' ? (
        <PlanTab channels={channels} />
      ) : tab === 'review' ? (
        <ReviewTab channels={channels} />
      ) : (
        <>
          {!settings.hasKey && <p className="max-w-prose text-sm text-text-muted">{t('intro')}</p>}
          <AiSettingsForm settings={settings} onSaved={setSettings} />
        </>
      )}
    </div>
  );
}
