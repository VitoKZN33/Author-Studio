'use client';

import type { UrlButton } from '@author-studio/shared';
import { useTranslations } from 'next-intl';

interface Props {
  rows: UrlButton[][];
  onChange: (rows: UrlButton[][]) => void;
  disabledReason?: string;
}

/** URL-кнопки под постом: ряды по горизонтали, до 8 кнопок в ряду. */
export function ButtonsPanel({ rows, onChange, disabledReason }: Props) {
  const t = useTranslations('editor.buttons');
  const update = (r: number, b: number, patch: Partial<UrlButton>) =>
    onChange(
      rows.map((row, i) =>
        i !== r ? row : row.map((btn, j) => (j === b ? { ...btn, ...patch } : btn)),
      ),
    );
  const remove = (r: number, b: number) =>
    onChange(
      rows
        .map((row, i) => (i === r ? row.filter((_, j) => j !== b) : row))
        .filter((row) => row.length > 0),
    );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-muted">{t('title')}</h2>
        <button
          type="button"
          disabled={!!disabledReason}
          onClick={() => onChange([...rows, [{ text: '', url: 'https://' }]])}
          className="min-h-9 rounded-[var(--radius-control)] border border-border-strong px-3 text-sm text-text-muted hover:text-text disabled:opacity-40"
        >
          {t('addRow')}
        </button>
      </div>
      {disabledReason && <p className="text-sm text-text-faint">{disabledReason}</p>}
      {rows.map((row, r) => (
        <div
          key={r}
          className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-2"
        >
          {row.map((btn, b) => (
            <div key={b} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
              <input
                value={btn.text}
                maxLength={64}
                onChange={(e) => update(r, b, { text: e.target.value })}
                placeholder={t('textPlaceholder')}
                aria-label={t('text')}
                className="min-h-10 min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-sm focus:border-accent focus:outline-none"
              />
              <input
                value={btn.url}
                type="url"
                inputMode="url"
                onChange={(e) => update(r, b, { url: e.target.value })}
                aria-label={t('url')}
                className="col-span-2 min-h-10 min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-sm focus:border-accent focus:outline-none sm:col-span-1"
              />
              <button
                type="button"
                onClick={() => remove(r, b)}
                aria-label={t('remove')}
                className="row-start-1 min-h-10 px-2 text-text-faint hover:text-text sm:row-auto"
              >
                ×
              </button>
            </div>
          ))}
          {row.length < 8 && (
            <button
              type="button"
              onClick={() =>
                onChange(rows.map((x, i) => (i === r ? [...x, { text: '', url: 'https://' }] : x)))
              }
              className="self-start text-sm text-text-muted underline underline-offset-4"
            >
              {t('addToRow')}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
