'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useSession } from '../session/session';
import { useSystemInfo } from '../system/use-system-info';
import { confirmAction } from '@/shared/telegram';
import { PageHeader } from '@/shared/ui/kit';
import { SystemStatus } from '../system/system-status';

export function SettingsScreen() {
  const t = useTranslations('settings');
  const format = useFormatter();
  const { state, logout } = useSession();
  const info = useSystemInfo();
  const [busy, setBusy] = useState(false);
  if (state.kind !== 'ready') return null;

  async function onLogout() {
    if (!(await confirmAction(t('confirmLogout')))) return;
    setBusy(true);
    await logout();
  }

  const rows: [string, string][] = [
    [t('rows.installation'), info?.appName ?? '…'],
    [t('rows.bot'), info ? (info.botUsername ? `@${info.botUsername}` : t('botUnknown')) : '…'],
    [t('rows.timezone'), info?.timezone ?? '…'],
    [t('rows.owner'), `${state.user.firstName} (ID ${state.user.telegramId})`],
    [
      t('rows.session'),
      format.dateTime(new Date(state.expiresAt), {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }),
    ],
    [t('rows.version'), info?.version ?? '…'],
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} back={{ href: '/more/', label: t('back') }} />
      <dl className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
            <dt className="text-text-muted">{k}</dt>
            <dd className="min-w-0 truncate text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <SystemStatus />
      <div>
        <button
          type="button"
          onClick={onLogout}
          disabled={busy}
          className="min-h-11 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm text-text-muted hover:text-text disabled:opacity-50"
        >
          {t('logout')}
        </button>
      </div>
    </div>
  );
}
