'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { Icon } from './icons';

/**
 * Общие элементы интерфейса (направление E): заголовок экрана, сегменты, карточки,
 * кнопки, нижний лист. Экраны собираются из них, а не из разрозненных классов.
 */

export const card = 'rounded-[var(--radius-card)] border border-border bg-surface';
export const cardPad = `${card} p-4`;

export const btn = {
  primary:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-accent px-4 font-bold text-on-accent disabled:opacity-50',
  ink: 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-ink px-4 font-bold text-on-ink disabled:opacity-50',
  soft: 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-surface-2 px-4 font-semibold text-text disabled:opacity-50',
  outline:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-surface px-4 font-semibold text-text disabled:opacity-50',
  danger:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-surface px-4 font-semibold text-danger disabled:opacity-50',
  link: 'font-semibold text-accent',
};

export const inputCls =
  'min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 text-[15px] outline-none focus:border-accent';

export function PageHeader({
  title,
  right,
  back,
}: {
  title: string;
  right?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="flex flex-col gap-1">
      {back && (
        <Link
          href={back.href}
          className="-ml-1 flex items-center gap-0.5 text-sm font-semibold text-accent"
        >
          <Icon name="back" size={18} />
          {back.label}
        </Link>
      )}
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-tight">{title}</h1>
        {right}
      </div>
    </header>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-1 rounded-[var(--radius-control)] bg-surface-2 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 truncate rounded-[9px] px-2 text-[13.5px] font-semibold ${
            value === o.value
              ? 'bg-surface text-text shadow-[0_1px_2px_rgb(0_0_0/0.08)]'
              : 'text-text-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Метка-«пилюля» (статус, источник значения). */
export function Pill({
  tone = 'neutral',
  solid = false,
  children,
}: {
  tone?: PillTone;
  /** Поверх картинки: непрозрачная подложка, чтобы текст читался в любой теме. */
  solid?: boolean;
  children: ReactNode;
}) {
  const cls = PILL[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-bold whitespace-nowrap ${solid ? `bg-surface ${cls.split(' ').find((c) => c.startsWith('text-'))} shadow-sm` : cls}`}
    >
      {children}
    </span>
  );
}
export type PillTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'faint';
const PILL: Record<PillTone, string> = {
  neutral: 'bg-surface-2 text-text-muted',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  faint: 'bg-surface-2 text-text-faint',
};

/** Заголовок блока на экране со ссылкой справа. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-0.5">
      <h2 className="text-[15px] font-bold">{children}</h2>
      {right}
    </div>
  );
}

/**
 * Нижний лист поверх экрана (окно публикации, предпросмотр). Закрывается по фону,
 * Esc и кнопке; прокрутка страницы под листом блокируется.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Закрыть"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />
      <div className="sheet-in safe-bottom relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[26px] bg-bg px-4 pt-2.5 md:rounded-[26px] md:pb-5">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border-strong md:hidden" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[19px] font-extrabold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="grid size-9 place-items-center rounded-full bg-surface-2 text-text-muted"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Пустое состояние: что сделать дальше. */
export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className={`${cardPad} flex flex-col items-start gap-2 border-dashed`}>
      <p className="font-bold">{title}</p>
      {text && <p className="text-sm text-text-muted">{text}</p>}
      {action}
    </div>
  );
}
