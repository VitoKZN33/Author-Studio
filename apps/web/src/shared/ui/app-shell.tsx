'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { SECTIONS, type SectionKey } from '../sections';

/**
 * Каркас приложения: боковая навигация на широком экране (Telegram Desktop),
 * нижняя панель на смартфоне. Неготовые разделы видны, но неактивны —
 * интерфейс не выдаёт будущие функции за работающие.
 */
export function AppShell({ active, children }: { active: SectionKey; children: ReactNode }) {
  const t = useTranslations();
  const items = SECTIONS.map((s) => ({
    ...s,
    label: t(`nav.${s.key}`),
    available: s.key === 'overview',
  }));

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-border bg-surface md:block">
        <div className="px-5 pt-6 pb-4">
          <div className="text-[15px] font-semibold tracking-tight">Author Studio</div>
          <div className="mt-0.5 text-xs text-text-faint">{t('app.tagline')}</div>
        </div>
        <nav aria-label={t('nav.overview')} className="flex flex-col gap-0.5 px-2">
          {items.map((item) => (
            <span
              key={item.key}
              aria-current={item.key === active ? 'page' : undefined}
              aria-disabled={!item.available || undefined}
              className={[
                'flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-sm',
                item.key === active ? 'bg-surface-2 text-text' : 'text-text-muted',
                item.available ? '' : 'opacity-50',
              ].join(' ')}
            >
              {item.label}
              {!item.available && (
                <span className="text-[11px] text-text-faint">
                  {t('overview.plannedStage', { stage: item.stage })}
                </span>
              )}
            </span>
          ))}
        </nav>
      </aside>

      <main className="mx-auto w-full max-w-5xl px-4 pt-5 pb-24 md:px-8 md:pt-8 md:pb-10">
        {children}
      </main>

      <nav
        aria-label={t('nav.overview')}
        className="fixed inset-x-0 bottom-0 grid grid-cols-4 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {items
          .filter((i) => ['overview', 'posts', 'calendar', 'settings'].includes(i.key))
          .map((item) => (
            <span
              key={item.key}
              aria-current={item.key === active ? 'page' : undefined}
              aria-disabled={!item.available || undefined}
              className={[
                'flex min-h-14 flex-col items-center justify-center text-[11px]',
                item.key === active ? 'text-text' : 'text-text-faint',
                item.available ? '' : 'opacity-50',
              ].join(' ')}
            >
              {item.label}
            </span>
          ))}
      </nav>
    </div>
  );
}
