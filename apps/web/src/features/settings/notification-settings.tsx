'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/shared/api';

type Prefs = { publishSuccess: boolean; publishProblems: boolean; integration: boolean };
const KEYS: (keyof Prefs)[] = ['publishProblems', 'integration', 'publishSuccess'];

/** Категории уведомлений, которые бот присылает владельцу. */
export function NotificationSettings({ hideTitle = false }: { hideTitle?: boolean }) {
  const t = useTranslations('settings.notifications');
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Prefs>('/settings/notifications')
      .then((p) => !cancelled && setPrefs(p))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(key: keyof Prefs) {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setError(null);
    try {
      setPrefs(await api.put<Prefs>('/settings/notifications', { [key]: next[key] }));
    } catch (e) {
      setPrefs(prefs);
      setError(e instanceof ApiError ? e.message : t('failed'));
    }
  }

  return (
    <section className="flex flex-col gap-2">
      {!hideTitle && <h2 className="px-0.5 text-[15px] font-bold">{t('title')}</h2>}
      <div className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {KEYS.map((k) => (
          <label
            key={k}
            className="flex min-h-12 items-center justify-between gap-4 px-4 py-2 text-sm"
          >
            <span>
              {t(`${k}.label`)}
              <span className="block text-xs text-text-faint">{t(`${k}.hint`)}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="size-5 shrink-0 accent-[var(--color-accent)]"
              checked={prefs?.[k] ?? false}
              disabled={!prefs}
              onChange={() => void toggle(k)}
            />
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
