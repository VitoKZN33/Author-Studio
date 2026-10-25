'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { AuthGate } from '@/features/session/auth-gate';
import { CURRENT_STAGE, POSTPONED_SECTIONS, SECTIONS, TAB_OF, type SectionKey } from '../sections';
import { Icon, type IconName } from './icons';
import { NewPostProvider, useNewPost } from './new-post';

/**
 * Каркас приложения: нижняя панель на смартфоне (Главная, Посты, «+», Статистика, Ещё)
 * и боковая навигация на широком экране (Telegram Desktop). Отложенные разделы видны,
 * но неактивны — интерфейс не выдаёт их за работающие.
 */
export function AppShell(props: { active: SectionKey; children: ReactNode; bare?: boolean }) {
  return (
    <NewPostProvider>
      <Shell {...props} />
    </NewPostProvider>
  );
}

function Shell({
  active,
  children,
  bare = false,
}: {
  active: SectionKey;
  children: ReactNode;
  /** Экран со своей нижней панелью (редактор): без панели разделов на смартфоне. */
  bare?: boolean;
}) {
  const t = useTranslations();
  const newPost = useNewPost();
  const tab = TAB_OF[active];
  const tabs: { key: 'overview' | 'posts' | 'analytics' | 'more'; href: string; icon: IconName }[] =
    [
      { key: 'overview', href: '/', icon: 'home' },
      { key: 'posts', href: '/posts/', icon: 'grid' },
      { key: 'analytics', href: '/analytics/', icon: 'chart' },
      { key: 'more', href: '/more/', icon: 'more' },
    ];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="hidden border-r border-border bg-surface md:block">
        <div className="sticky top-0 flex flex-col gap-4 px-3 pt-6">
          <div className="px-2 text-[17px] font-extrabold tracking-tight">Author Studio</div>
          <button
            type="button"
            onClick={() => void newPost.create()}
            disabled={newPost.busy}
            className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-ink font-bold text-on-ink disabled:opacity-60"
          >
            <Icon name="plus" size={18} strokeWidth={2.2} />
            {t('nav.newPost')}
          </button>
          <nav aria-label={t('nav.label')} className="flex flex-col gap-0.5">
            {SECTIONS.map((s) => {
              const postponed = POSTPONED_SECTIONS.includes(s.key);
              const available = s.stage <= CURRENT_STAGE && !postponed;
              const cls =
                'flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm';
              return available ? (
                <Link
                  key={s.key}
                  href={s.href}
                  aria-current={s.key === active ? 'page' : undefined}
                  className={`${cls} ${s.key === active ? 'bg-accent-soft font-bold text-accent' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`}
                >
                  <Icon name={s.icon} />
                  {t(`nav.${s.key}`)}
                </Link>
              ) : (
                <span key={s.key} aria-disabled="true" className={`${cls} text-text-faint`}>
                  <Icon name={s.icon} />
                  {t(`nav.${s.key}`)}
                  <span className="ml-auto text-[11px]">
                    {postponed ? t('nav.postponed') : t('nav.soon', { stage: s.stage })}
                  </span>
                </span>
              );
            })}
          </nav>
        </div>
      </aside>

      <main
        className={`mx-auto w-full max-w-4xl px-4 pt-4 md:px-10 md:pt-8 md:pb-12 ${bare ? 'pb-32' : 'pb-28'}`}
      >
        <AuthGate>{children}</AuthGate>
      </main>

      {!bare && (
        <nav
          aria-label={t('nav.label')}
          className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-center border-t border-border bg-surface/95 pt-1.5 backdrop-blur md:hidden"
        >
          {tabs.slice(0, 2).map((x) => (
            <Tab
              key={x.key}
              href={x.href}
              icon={x.icon}
              label={t(`navShort.${x.key}`)}
              on={tab === x.key}
            />
          ))}
          <div className="flex justify-center">
            <button
              type="button"
              aria-label={t('nav.newPost')}
              onClick={() => void newPost.create()}
              disabled={newPost.busy}
              className="grid size-12 place-items-center rounded-[14px] bg-ink text-on-ink active:scale-95 disabled:opacity-60"
            >
              <Icon name="plus" size={24} strokeWidth={2.2} />
            </button>
          </div>
          {tabs.slice(2).map((x) => (
            <Tab
              key={x.key}
              href={x.href}
              icon={x.icon}
              label={t(`navShort.${x.key}`)}
              on={tab === x.key}
            />
          ))}
        </nav>
      )}
    </div>
  );
}

function Tab({
  href,
  icon,
  label,
  on,
}: {
  href: string;
  icon: IconName;
  label: string;
  on: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={on ? 'page' : undefined}
      className={`flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] ${on ? 'font-bold text-accent' : 'text-text-faint'}`}
    >
      <Icon name={icon} size={24} strokeWidth={on ? 2 : 1.7} />
      {label}
    </Link>
  );
}
