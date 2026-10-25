'use client';

import { useTranslations } from 'next-intl';

/** Инструкция подключения — это действительно последовательность, поэтому нумерованный список. */
export function AddBotSteps({
  botUsername,
  defaultOpen,
}: {
  botUsername: string | null;
  defaultOpen: boolean;
}) {
  const t = useTranslations('channels.howTo');
  const bot = botUsername ? `@${botUsername}` : t('yourBot');
  return (
    <details
      open={defaultOpen}
      className="group rounded-[var(--radius-card)] border border-border bg-surface"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium">
        {t('title')}
        <span aria-hidden className="text-text-faint transition-transform group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <ol className="list-decimal space-y-2 px-4 pb-4 pl-9 text-sm leading-relaxed text-text-muted marker:text-text-faint">
        <li>{t('step1')}</li>
        <li>{t('step2', { bot })}</li>
        <li>{t('step3')}</li>
        <li>{t('step4')}</li>
      </ol>
    </details>
  );
}
