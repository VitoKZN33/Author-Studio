'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/shared/api';
import { haptic } from '@/shared/telegram';
import type { Channel } from '../channels/types';
import type { PlanResult } from './types';
import { Alert, card, errorText, Field, input, primaryBtn, secondaryBtn } from './ui';

/** Контент-план от AI. Ничего не создаётся, пока владелец не выберет пункты. */
export function PlanTab({ channels }: { channels: Channel[] }) {
  const t = useTranslations('ai.plan');
  const format = useFormatter();
  const [topic, setTopic] = useState('');
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const [perWeek, setPerWeek] = useState(5);
  const [busy, setBusy] = useState<'plan' | 'drafts' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [created, setCreated] = useState<number | null>(null);

  async function suggest() {
    setBusy('plan');
    setError(null);
    setCreated(null);
    try {
      const r = await api.post<PlanResult>('/ai/plan', {
        topic,
        days,
        postsPerWeek: perWeek,
        ...(channelId ? { channelId } : {}),
      });
      setPlan(r);
      setPicked(new Set(r.items.map((_, i) => i)));
    } catch (e) {
      setError(errorText(e, t('failed')));
    } finally {
      setBusy(null);
    }
  }

  async function createDrafts() {
    if (!plan) return;
    setBusy('drafts');
    setError(null);
    try {
      const items = plan.items
        .filter((_, i) => picked.has(i))
        .map((i) => ({ title: i.title, idea: i.idea }));
      const r = await api.post<{ ids: string[] }>('/ai/plan/drafts', { items });
      haptic('success');
      setCreated(r.ids.length);
    } catch (e) {
      setError(errorText(e, t('draftsFailed')));
    } finally {
      setBusy(null);
    }
  }

  const dayLabel = (d: string) =>
    format.dateTime(new Date(`${d}T12:00:00Z`), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <Field label={t('topic')} hint={t('topicHint')}>
          <textarea
            className={`${input} min-h-24 py-2`}
            maxLength={3000}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t('topicPlaceholder')}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('channel')}>
            <select
              className={input}
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            >
              <option value="">{t('noChannel')}</option>
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
              onChange={(e) => setDays(Number(e.target.value) as 7 | 14 | 30)}
            >
              {([7, 14, 30] as const).map((d) => (
                <option key={d} value={d}>
                  {t('days', { d })}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('perWeek')}>
            <input
              className={input}
              type="number"
              min={1}
              max={21}
              value={perWeek}
              onChange={(e) => setPerWeek(Math.min(21, Math.max(1, Number(e.target.value) || 1)))}
            />
          </Field>
        </div>
        <p className="text-xs text-text-faint">{t('channelHint')}</p>
        <button
          type="button"
          className={`${primaryBtn} self-start`}
          disabled={!!busy || (!topic.trim() && !channelId)}
          onClick={() => void suggest()}
        >
          {busy === 'plan' ? t('thinking') : t('suggest')}
        </button>
      </section>

      {error && <Alert>{error}</Alert>}

      {plan && (
        <section className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">{t('result', { n: plan.items.length })}</h2>
            {plan.rejected > 0 && (
              <span className="text-xs text-text-faint">{t('rejected', { n: plan.rejected })}</span>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {plan.items.map((item, i) => (
              <li key={i} className="py-2.5">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
                    checked={picked.has(i)}
                    onChange={(e) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(i);
                        else n.delete(i);
                        return n;
                      })
                    }
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs text-text-faint">
                      {dayLabel(item.date)}
                      {item.time ? `, ${item.time}` : ''}
                    </span>
                    <span className="text-sm font-medium">{item.title}</span>
                    <span className="text-sm whitespace-pre-wrap text-text-muted">{item.idea}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-faint">{t('draftsHint')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryBtn}
              disabled={!!busy || picked.size === 0}
              onClick={() => void createDrafts()}
            >
              {busy === 'drafts' ? t('creating') : t('createDrafts', { n: picked.size })}
            </button>
            <button
              type="button"
              className={secondaryBtn}
              disabled={!!busy}
              onClick={() => void suggest()}
            >
              {t('again')}
            </button>
          </div>
          {created !== null && (
            <p className="text-sm text-ok">
              {t('created', { n: created })}{' '}
              <Link href="/posts/" className="underline underline-offset-4">
                {t('toPosts')}
              </Link>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
