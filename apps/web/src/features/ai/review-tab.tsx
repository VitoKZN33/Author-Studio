'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/shared/api';
import type { Channel } from '../channels/types';
import { KindTag } from '../analytics/value-kind';
import type { ValueKind } from '../analytics/types';
import type { Review } from './types';
import { Alert, card, errorText, Field, input, primaryBtn } from './ui';

const SOURCE_KIND: Record<Review['facts'][number]['source'], ValueKind> = {
  telegram: 'fact',
  system: 'measured',
  manual: 'manual',
  calc: 'estimate',
};

/**
 * Разбор статистики: факты считает приложение (показываются отдельно и первыми),
 * модель только интерпретирует их. Достаточность данных — правило приложения.
 */
export function ReviewTab({ channels }: { channels: Channel[] }) {
  const t = useTranslations('ai.review');
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setReview(await api.post<Review>('/ai/analytics', { channelId, days }));
    } catch (e) {
      setError(errorText(e, t('failed')));
    } finally {
      setBusy(false);
    }
  }

  if (channels.length === 0) return <p className="text-sm text-text-muted">{t('noChannels')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('channel')}>
            <select
              className={input}
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('period')}>
            <select
              className={input}
              value={days}
              onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 90)}
            >
              {([7, 30, 90] as const).map((d) => (
                <option key={d} value={d}>
                  {t('days', { d })}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button
          type="button"
          className={`${primaryBtn} self-start`}
          disabled={busy || !channelId}
          onClick={() => void run()}
        >
          {busy ? t('thinking') : t('run')}
        </button>
      </section>

      {error && <Alert>{error}</Alert>}

      {review && (
        <>
          <section className={card}>
            <h2 className="text-sm font-medium">
              {t('factsTitle', { channel: review.period.channelTitle, d: review.period.days })}
            </h2>
            <p className="text-xs text-text-faint">{t('factsHint')}</p>
            <dl className="flex flex-col divide-y divide-border text-sm">
              {review.facts.map((f) => (
                <div key={f.label} className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-text-muted">{f.label}</dt>
                  <dd className="flex items-baseline gap-2 text-right">
                    <span className="tabular-nums">{f.value}</span>
                    <KindTag kind={SOURCE_KIND[f.source]} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={card}>
            <h2 className="text-sm font-medium">
              {t('sufficiency')}: {t(`level.${review.sufficiency.level}`)}
            </h2>
            {review.sufficiency.reasons.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-text-muted">
                {review.sufficiency.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </section>

          {review.ai ? (
            <section className={card}>
              <h2 className="text-sm font-medium">{t('aiTitle', { model: review.ai.model })}</h2>
              {review.ai.unverifiedNumbers.length > 0 && (
                <Alert tone="warn">
                  {t('unverified', { list: review.ai.unverifiedNumbers.join(', ') })}
                </Alert>
              )}
              {review.ai.truncated && <Alert tone="warn">{t('truncated')}</Alert>}
              {(['observations', 'hypotheses', 'recommendations'] as const).map((k) =>
                review.ai![k].length ? (
                  <div key={k} className="flex flex-col gap-1.5">
                    <h3 className="text-xs font-medium tracking-wide text-text-muted uppercase">
                      {t(k)}
                    </h3>
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                      {review.ai![k].map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
              <p className="text-xs text-text-faint">{t('disclaimer')}</p>
            </section>
          ) : (
            <p className="text-sm text-text-muted">{t('notEnoughForAi')}</p>
          )}
        </>
      )}
    </div>
  );
}
