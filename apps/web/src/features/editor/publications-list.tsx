'use client';

import { utcToZonedWallTime, zonedWallTimeToUtc } from '@author-studio/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { confirmAction, haptic } from '@/shared/telegram';
import { postLink, STATUS_TONE, type PublicationView } from '../posts/types';

interface Props {
  items: PublicationView[];
  timezone: string;
  onChange: (p: PublicationView) => void;
}

/** Отправки публикации по каналам: статус и действия для каждой. */
export function PublicationsList({ items, timezone, onChange }: Props) {
  const t = useTranslations('publications');
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-text-muted">{t('title')}</h2>
      {items.map((p) => (
        <PublicationRow key={p.id} p={p} timezone={timezone} onChange={onChange} />
      ))}
    </section>
  );
}

function PublicationRow({
  p,
  timezone,
  onChange,
}: {
  p: PublicationView;
  timezone: string;
  onChange: (p: PublicationView) => void;
}) {
  const t = useTranslations('publications');
  const format = useFormatter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(() => utcToZonedWallTime(new Date(p.scheduledAt), timezone));

  async function run(path: string, body?: unknown, confirm?: string) {
    if (confirm && !(await confirmAction(confirm))) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<PublicationView>(`/publications/${p.id}/${path}`, body);
      haptic('success');
      setEditing(false);
      onChange(r);
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  const time = format.dateTime(new Date(p.publishedAt ?? p.scheduledAt), {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const link = postLink(p);

  return (
    <article className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{p.channelTitle}</div>
          <div className="text-xs text-text-faint">{t(`when.${p.status}`, { time })}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${STATUS_TONE[p.status]}`}>
          {t(`status.${p.status}`)}
        </span>
      </div>

      {p.status === 'ambiguous' && (
        <p className="mt-2 text-sm leading-relaxed text-warn">{t('ambiguousHint')}</p>
      )}
      {p.lastError && p.status !== 'ambiguous' && (
        <p className="mt-2 text-sm text-text-muted">{p.lastError}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {editing && (
        <div className="mt-3 flex gap-2">
          <input
            type="datetime-local"
            value={when}
            min={utcToZonedWallTime(new Date(), timezone)}
            onChange={(e) => setWhen(e.target.value)}
            aria-label={t('newTime')}
            className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-sm [color-scheme:dark]"
          />
          <Btn
            primary
            disabled={busy}
            onClick={() =>
              void run('reschedule', {
                scheduledAt: zonedWallTimeToUtc(when, timezone).toISOString(),
              })
            }
          >
            {t('save')}
          </Btn>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {p.status === 'scheduled' && !editing && (
          <>
            <Btn disabled={busy} onClick={() => setEditing(true)}>
              {t('reschedule')}
            </Btn>
            <Btn
              disabled={busy}
              onClick={() =>
                void run('cancel', undefined, t('confirmCancel', { channel: p.channelTitle }))
              }
            >
              {t('cancel')}
            </Btn>
          </>
        )}
        {p.status === 'failed' && (
          <Btn primary disabled={busy} onClick={() => void run('retry')}>
            {t('retry')}
          </Btn>
        )}
        {p.status === 'ambiguous' && (
          <>
            <Btn
              primary
              disabled={busy}
              onClick={() => void run('resolve', { outcome: 'published' })}
            >
              {t('resolvePublished')}
            </Btn>
            <Btn
              disabled={busy}
              onClick={() => void run('resolve', { outcome: 'resend' }, t('confirmResend'))}
            >
              {t('resolveResend')}
            </Btn>
          </>
        )}
        {p.status === 'published' && link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent underline underline-offset-4"
          >
            {t('open')}
          </a>
        )}
      </div>
    </article>
  );
}

function Btn({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-10 rounded-[var(--radius-control)] px-3.5 text-sm disabled:opacity-50 ${
        primary
          ? 'bg-accent font-medium text-bg'
          : 'border border-border-strong text-text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}
