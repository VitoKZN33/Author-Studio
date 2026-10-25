'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { haptic } from '@/shared/telegram';
import { btn, PageHeader, Segmented } from '@/shared/ui/kit';
import { ChannelChip } from '../channels/channel-chip';
import { useChannels } from '../channels/use-channels';
import {
  AdsSection,
  AudienceSection,
  EffectivenessSection,
  EngagementSection,
  LinksSection,
  ReachSection,
} from './report/sections';
import type { Report } from './report/types';
import { KindLegend } from './value-kind';

type Days = 7 | 30 | 90;

/**
 * «Статистика» — один экран из шести разделов: аудитория, охваты, вовлечённость,
 * эффективность, реклама, переходы. Сверху только выбор периода.
 */
export function AnalyticsScreen() {
  const t = useTranslations('analytics');
  const format = useFormatter();
  const { channels, selected: channelId, select } = useChannels();
  const [days, setDays] = useState<Days>(30);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    api
      .get<Report>(`/analytics/channels/${channelId}/report?days=${days}`)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setError(null);
      })
      .catch(
        (e: unknown) => !cancelled && setError(e instanceof ApiError ? e.message : t('loadFailed')),
      );
    return () => {
      cancelled = true;
    };
  }, [channelId, days, reload, t]);

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

  const changed = () => setReload((n) => n + 1);
  const since = report?.coverage.subscribersSince;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <PageHeader
          title={t('title')}
          right={
            channels && <ChannelChip channels={channels} selected={channelId} onSelect={select} />
          }
        />
        <Segmented
          label={t('period')}
          value={days}
          onChange={setDays}
          options={([7, 30, 90] as const).map((d) => ({ value: d, label: t('daysLong', { d }) }))}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {!report && !error && (
        <p className="text-sm text-text-muted" aria-busy="true">
          {t('loading')}
        </p>
      )}

      {report && (
        <>
          <AudienceSection r={report} />
          <ReachSection r={report} channelId={channelId} onChanged={changed} />
          <EngagementSection r={report} />
          <EffectivenessSection r={report} />
          <AdsSection r={report} />
          <LinksSection r={report} channelId={channelId} onChanged={changed} />

          <Link
            href="/ai/?tab=review"
            className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-ink px-4 py-3.5 text-on-ink"
          >
            <span className="min-w-0">
              <span className="block font-bold">{t('ai.title')}</span>
              <span className="block text-[13px] opacity-70">{t('ai.text')}</span>
            </span>
            <span className="shrink-0 rounded-full bg-accent px-3.5 py-2 text-sm font-bold text-on-accent">
              {t('ai.action')}
            </span>
          </Link>

          <KindLegend />
          <p className="text-xs leading-relaxed text-text-faint">
            {since
              ? t('coverage', {
                  since: format.dateTime(new Date(since), {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }),
                  every: report.coverage.intervalMinutes,
                })
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
    </div>
  );
}
