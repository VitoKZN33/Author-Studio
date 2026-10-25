'use client';

import { useTranslations } from 'next-intl';
import type { ValueKind } from './types';

const TONE: Record<ValueKind, string> = {
  fact: 'bg-accent-soft text-accent',
  measured: 'bg-ok-soft text-ok',
  manual: 'bg-warn-soft text-warn',
  estimate: 'bg-surface-2 text-text-muted',
  none: 'bg-surface-2 text-text-faint',
};

/** Пометка происхождения значения — текстом, а не только цветом. */
export function KindTag({ kind }: { kind: ValueKind }) {
  const t = useTranslations('analytics.kind');
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${TONE[kind]}`}
    >
      {t(kind)}
    </span>
  );
}

export function KindLegend() {
  const t = useTranslations('analytics.kind');
  return (
    <details className="text-xs text-text-muted">
      <summary className="cursor-pointer select-none">{t('legendTitle')}</summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {(['fact', 'measured', 'manual', 'estimate', 'none'] as const).map((k) => (
          <li key={k} className="flex items-start gap-2">
            <KindTag kind={k} />
            <span>{t(`${k}Hint`)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
