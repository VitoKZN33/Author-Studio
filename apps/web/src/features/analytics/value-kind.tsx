'use client';

import { useTranslations } from 'next-intl';
import type { ValueKind } from './types';

const TONE: Record<ValueKind, string> = {
  fact: 'border-ok/40 text-ok',
  measured: 'border-accent/40 text-accent',
  manual: 'border-warn/40 text-warn',
  estimate: 'border-border-strong text-text-muted',
  none: 'border-border text-text-faint',
};

/** Пометка происхождения значения — текстом, а не только цветом. */
export function KindTag({ kind }: { kind: ValueKind }) {
  const t = useTranslations('analytics.kind');
  return (
    <span className={`rounded border px-1.5 py-px text-[10.5px] whitespace-nowrap ${TONE[kind]}`}>
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
