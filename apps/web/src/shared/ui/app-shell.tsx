'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { AuthGate } from '@/features/session/auth-gate';
import {
  CURRENT_STAGE,
  MOBILE_TABS,
  POSTPONED_SECTIONS,
  SECTIONS,
  type SectionKey,
} from '../sections';

/**
 * Каркас приложения: боковая навигация на широком экране (Telegram Desktop),
 * нижняя панель на смартфоне. Разделы будущих этапов видны, но неактивны —
 * интерфейс не выдаёт будущие функции за работающие.
 */
export function AppShell({ active, children }: { active: SectionKey; children: ReactNode }) {
  const t = useTranslations();
  const items = SECTIONS.map((s) => ({
    ...s,
    label: t(`nav.${s.key}`),
    available: s.stage <= CURRENT_STAGE && !POSTPONED_SECTIONS.includes(s.key),
  }));

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <aside className="hidden border-r border-border bg-surface md:block">
        <div className="sticky top-0">
          <div className="px-5 pt-6 pb-5">
            <div className="text-[15px] font-semibold tracking-tight">Author Studio</div>
            <div className="mt-0.5 text-xs text-text-faint">{t('app.tagline')}</div>
          </div>
          <nav aria-label={t('nav.label')} className="flex flex-col gap-0.5 px-2">
            {items.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                active={item.key === active}
                variant="side"
                soon={
                  POSTPONED_SECTIONS.includes(item.key)
                    ? t('nav.postponed')
                    : t('nav.soon', { stage: item.stage })
                }
              />
            ))}
          </nav>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-4xl px-4 pt-5 pb-28 md:px-10 md:pt-9 md:pb-12">
        <AuthGate>{children}</AuthGate>
      </main>

      <nav
        aria-label={t('nav.label')}
        className="fixed inset-x-0 bottom-0 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {items
          .filter((i) => MOBILE_TABS.includes(i.key))
          .map((item) => (
            <NavItem
              key={item.key}
              item={{ ...item, label: t(`navShort.${item.key}`) }}
              active={item.key === active}
              variant="tab"
              soon=""
            />
          ))}
      </nav>
    </div>
  );
}

interface NavItemProps {
  item: { key: SectionKey; href: string; label: string; available: boolean };
  active: boolean;
  variant: 'side' | 'tab';
  soon: string;
}

function NavItem({ item, active, variant, soon }: NavItemProps) {
  const base =
    variant === 'side'
      ? 'flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-sm'
      : 'flex min-h-14 min-w-0 items-center justify-center px-0.5 text-center text-[11px] leading-tight [overflow-wrap:anywhere]';
  const tone = active ? 'bg-surface-2 text-text' : 'text-text-muted';
  const tabTone = active ? 'text-text font-medium' : 'text-text-faint';

  if (!item.available) {
    return (
      <span
        aria-disabled="true"
        className={`${base} ${variant === 'side' ? 'text-text-faint' : 'text-text-faint/60'}`}
      >
        {item.label}
        {variant === 'side' && <span className="text-[11px] text-text-faint">{soon}</span>}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`${base} ${variant === 'side' ? `${tone} hover:text-text` : tabTone}`}
    >
      {item.label}
    </Link>
  );
}
