'use client';

import type { ReadinessReport } from '@author-studio/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

type State =
  { kind: 'loading' } | { kind: 'unreachable' } | { kind: 'loaded'; report: ReadinessReport };

const COMPONENTS = ['database', 'redis', 'worker'] as const;

async function requestStatus(): Promise<State> {
  try {
    const res = await fetch('/api/health/status', { cache: 'no-store' });
    const report = (await res.json()) as ReadinessReport;
    if (!report || typeof report !== 'object' || !('checks' in report)) throw new Error();
    return { kind: 'loaded', report };
  } catch {
    return { kind: 'unreachable' };
  }
}

/** Карточка состояния установки: опрашивает /api/health/status. */
export function SystemStatus() {
  const t = useTranslations('system');
  const format = useFormatter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const [requestId, setRequestId] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void requestStatus().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const refresh = () => {
    setState({ kind: 'loading' });
    setRequestId((n) => n + 1);
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">{t('title')}</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={state.kind === 'loading'}
          className="min-h-9 rounded-[var(--radius-control)] border border-border-strong px-3 text-xs text-text-muted hover:text-text disabled:opacity-50"
        >
          {state.kind === 'loading' ? t('checking') : t('refresh')}
        </button>
      </header>

      <div className="px-4 py-3" aria-live="polite">
        {state.kind === 'loading' && <p className="text-sm text-text-muted">{t('checking')}</p>}

        {state.kind === 'unreachable' && <p className="text-sm text-danger">{t('unreachable')}</p>}

        {state.kind === 'loaded' && (
          <>
            <p
              className={`mb-3 text-sm ${state.report.status === 'ok' ? 'text-ok' : 'text-danger'}`}
            >
              {state.report.status === 'ok' ? t('allOk') : t('hasProblems')}
            </p>
            <ul className="divide-y divide-border">
              {COMPONENTS.map((key) => {
                const check = state.report.checks[key];
                const ok = check?.status === 'ok';
                return (
                  <li key={key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span>{t(`components.${key}`)}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}
                      title={check?.message}
                    >
                      {ok ? t('ok') : (check?.message ?? t('fail'))}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-text-faint">
              {t('checkedAt', {
                time: format.dateTime(new Date(state.report.timestamp), {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                }),
              })}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
