'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MORE_SECTIONS, POSTPONED_SECTIONS, SECTIONS } from '@/shared/sections';
import { Icon } from '@/shared/ui/icons';
import { PageHeader } from '@/shared/ui/kit';

export function MoreScreen() {
  const t = useTranslations();
  const items = MORE_SECTIONS.map((k) => SECTIONS.find((s) => s.key === k)!);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('more.title')} />
      <ul className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        {items.map((s) => {
          const off = POSTPONED_SECTIONS.includes(s.key);
          const inner = (
            <>
              <span
                className={`grid size-10 place-items-center rounded-[12px] ${off ? 'bg-surface-2 text-text-faint' : 'bg-accent-soft text-accent'}`}
              >
                <Icon name={s.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block font-semibold ${off ? 'text-text-faint' : ''}`}>
                  {t(`nav.${s.key}`)}
                </span>
                <span className="block text-[13px] text-text-faint">{t(`more.hint.${s.key}`)}</span>
              </span>
              {!off && <Icon name="chevron" size={18} className="text-text-faint" />}
            </>
          );
          return (
            <li key={s.key} className="border-b border-border last:border-0">
              {off ? (
                <div aria-disabled="true" className="flex items-center gap-3 px-4 py-3">
                  {inner}
                </div>
              ) : (
                <Link
                  href={s.href}
                  className="flex items-center gap-3 px-4 py-3 active:bg-surface-2"
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
