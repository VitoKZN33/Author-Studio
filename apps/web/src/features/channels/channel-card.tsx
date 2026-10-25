'use client';

import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { confirmAction, haptic } from '@/shared/telegram';
import { RECOMMENDED_RIGHTS, REQUIRED_RIGHTS, type Channel, type RightKey } from './types';

const STATUS_TONE: Record<Channel['status'], string> = {
  active: 'bg-ok-soft text-ok',
  rights_missing: 'bg-warn-soft text-warn',
  bot_removed: 'bg-danger-soft text-danger',
  detected: 'bg-accent-soft text-accent',
  disconnected: 'bg-surface-2 text-text-faint',
};

export function ChannelCard({
  channel,
  onChange,
}: {
  channel: Channel;
  onChange: (c: Channel) => void;
}) {
  const t = useTranslations('channels');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [busy, setBusy] = useState<null | 'check' | 'connect' | 'disconnect'>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: 'check' | 'connect' | 'disconnect') {
    if (
      action === 'disconnect' &&
      !(await confirmAction(t('confirmDisconnect', { title: channel.title })))
    ) {
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const updated = await api.post<Channel>(`/channels/${channel.id}/${action}`);
      haptic(updated.status === 'active' || action === 'disconnect' ? 'success' : 'warning');
      onChange(updated);
    } catch (err) {
      haptic('error');
      setError(err instanceof ApiError ? err.message : t('actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  const showRights = channel.status !== 'disconnected' && channel.rights;

  return (
    <article className="rounded-[var(--radius-card)] border border-border bg-surface">
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-medium">{channel.title}</h3>
          {channel.username && (
            <p className="mt-0.5 truncate text-xs text-text-faint">@{channel.username}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${STATUS_TONE[channel.status]}`}
        >
          {t(`status.${channel.status}`)}
        </span>
      </header>

      <p className="px-4 pt-2 text-sm leading-relaxed text-text-muted">
        {t(`statusHint.${channel.status}`)}
      </p>

      {showRights && (
        <ul className="mx-4 mt-3 grid gap-px overflow-hidden rounded-[var(--radius-control)] border border-border bg-border sm:grid-cols-2">
          {REQUIRED_RIGHTS.map((k) => (
            <RightRow key={k} label={t(`rights.${k}`)} ok={channel.rights![k]} required />
          ))}
          {RECOMMENDED_RIGHTS.map((k) => (
            <RightRow
              key={k}
              label={t(`rights.${k}`)}
              ok={channel.rights![k]}
              required={false}
              hint={t(`rightsHint.${k as RightKey}`)}
            />
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="px-4 pt-3 text-sm text-danger">
          {error}
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-4">
        {channel.status === 'detected' || channel.status === 'disconnected' ? (
          <ActionButton
            primary
            busy={busy === 'connect'}
            disabled={!!busy}
            onClick={() => run('connect')}
          >
            {busy === 'connect' ? t('actions.connecting') : t('actions.connect')}
          </ActionButton>
        ) : (
          <>
            <ActionButton
              primary={channel.status !== 'active'}
              busy={busy === 'check'}
              disabled={!!busy}
              onClick={() => run('check')}
            >
              {busy === 'check' ? t('actions.checking') : t('actions.check')}
            </ActionButton>
            <ActionButton
              busy={busy === 'disconnect'}
              disabled={!!busy}
              onClick={() => run('disconnect')}
            >
              {t('actions.disconnect')}
            </ActionButton>
          </>
        )}
        {channel.rightsCheckedAt && channel.status !== 'disconnected' && (
          <span className="ml-auto text-xs text-text-faint">
            {t('checkedAt', { when: format.relativeTime(new Date(channel.rightsCheckedAt), now) })}
          </span>
        )}
      </footer>
    </article>
  );
}

function RightRow({
  label,
  ok,
  required,
  hint,
}: {
  label: string;
  ok: boolean;
  required: boolean;
  hint?: string;
}) {
  const icon = ok ? '✓' : required ? '✕' : '–';
  const tone = ok ? 'text-ok' : required ? 'text-danger' : 'text-text-faint';
  return (
    <li
      className="flex items-center gap-2.5 bg-surface-2 px-3 py-2 text-sm"
      title={!ok && hint ? hint : undefined}
    >
      <span aria-hidden className={`w-4 text-center font-semibold ${tone}`}>
        {icon}
      </span>
      <span className={ok ? 'text-text' : required ? 'text-text' : 'text-text-muted'}>{label}</span>
      <span className="sr-only">{ok ? 'есть' : 'нет'}</span>
    </li>
  );
}

function ActionButton({
  children,
  onClick,
  primary = false,
  busy,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
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
