'use client';

import { utcToZonedWallTime, zonedWallTimeToUtc, type ContentProblem } from '@author-studio/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { haptic } from '@/shared/telegram';
import type { Channel } from '../channels/types';
import type { PublicationView } from '../posts/types';

interface Props {
  postId: string;
  channels: Channel[];
  timezone: string;
  problems: ContentProblem[];
  /** Сохраняет черновик и возвращает актуальную версию (null — сохранить не удалось). */
  saveNow: () => Promise<number | null>;
  onPublished: (items: PublicationView[]) => void;
}

export function PublishPanel({
  postId,
  channels,
  timezone,
  problems,
  saveNow,
  onPublished,
}: Props) {
  const t = useTranslations('editor.publish');
  const active = channels.filter((c) => c.status === 'active');
  const [selected, setSelected] = useState<string[]>(() =>
    active.length === 1 ? [active[0]!.id] : [],
  );
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [when, setWhen] = useState(() =>
    utcToZonedWallTime(new Date(Date.now() + 3600_000), timezone),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const disabled =
    busy || selected.length === 0 || problems.length > 0 || (mode === 'later' && !when);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let scheduledAt: string | null = null;
      if (mode === 'later') {
        const at = zonedWallTimeToUtc(when, timezone);
        if (at.getTime() < Date.now()) throw new ApiError(400, t('pastTime'));
        scheduledAt = at.toISOString();
      }
      const version = await saveNow();
      if (version === null) throw new ApiError(409, t('saveFirst'));
      const r = await api.post<{ items: PublicationView[] }>(`/posts/${postId}/publish`, {
        channelIds: selected,
        scheduledAt,
        version,
      });
      haptic('success');
      onPublished(r.items);
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">{t('title')}</h2>

      {channels.length === 0 ? (
        <p className="text-sm text-text-muted">{t('noChannels')}</p>
      ) : (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm text-text-muted">{t('channels')}</legend>
          {channels.map((c) => {
            const ok = c.status === 'active';
            return (
              <label
                key={c.id}
                className={`flex min-h-10 items-center gap-3 text-sm ${ok ? '' : 'opacity-50'}`}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-accent)]"
                  disabled={!ok}
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span className="truncate">{c.title}</span>
                {!ok && <span className="text-xs text-text-faint">{t('unavailable')}</span>}
              </label>
            );
          })}
        </fieldset>
      )}

      <div
        className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-surface-2 p-1"
        role="radiogroup"
        aria-label={t('when')}
      >
        {(['now', 'later'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={`min-h-9 rounded-[6px] text-sm ${mode === m ? 'bg-surface text-text shadow-sm' : 'text-text-muted'}`}
          >
            {t(m)}
          </button>
        ))}
      </div>

      {mode === 'later' && (
        <label className="flex flex-col gap-1 text-sm text-text-muted">
          {t('dateTime', { tz: timezone })}
          <input
            type="datetime-local"
            value={when}
            min={utcToZonedWallTime(new Date(), timezone)}
            onChange={(e) => setWhen(e.target.value)}
            className="min-h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-[15px] text-text [color-scheme:dark] focus:border-accent focus:outline-none"
          />
        </label>
      )}

      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-warn" aria-live="polite">
          {problems.map((p, i) => (
            <li key={i}>• {p.message}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={disabled}
        className="min-h-11 rounded-[var(--radius-control)] bg-accent text-sm font-medium text-bg disabled:opacity-40"
      >
        {busy ? t('busy') : mode === 'now' ? t('publishNow') : t('schedule')}
      </button>
    </section>
  );
}
