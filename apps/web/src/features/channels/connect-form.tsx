'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/shared/api';
import { haptic } from '@/shared/telegram';
import type { Channel } from './types';

export function ConnectForm({ onConnected }: { onConnected: (c: Channel) => void }) {
  const t = useTranslations('channels.connect');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const channel = await api.post<Channel>('/channels/connect', { chat: value.trim() });
      haptic('success');
      setValue('');
      onConnected(channel);
    } catch (err) {
      haptic('error');
      setError(err instanceof ApiError ? err.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor="channel-ref" className="text-sm text-text-muted">
        {t('label')}
      </label>
      <div className="flex gap-2">
        <input
          id="channel-ref"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('placeholder')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'channel-ref-error' : undefined}
          className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-[15px] placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="min-h-11 shrink-0 rounded-[var(--radius-control)] bg-accent px-4 text-sm font-medium text-bg disabled:opacity-40"
        >
          {busy ? t('busy') : t('submit')}
        </button>
      </div>
      {error && (
        <p id="channel-ref-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
