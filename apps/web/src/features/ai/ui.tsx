'use client';

import type { ReactNode } from 'react';
import { ApiError } from '@/shared/api';

export const card =
  'flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4';
export const input =
  'min-h-10 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-sm';
export const primaryBtn =
  'min-h-10 rounded-[var(--radius-control)] bg-accent px-4 text-sm font-medium text-bg disabled:opacity-50';
export const secondaryBtn =
  'min-h-10 rounded-[var(--radius-control)] border border-border-strong px-3.5 text-sm text-text-muted hover:text-text disabled:opacity-50';

export function errorText(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  const provider = (e.details as { provider?: string | null } | undefined)?.provider;
  return provider ? `${e.message} Ответ провайдера: «${provider}»` : e.message;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-text-faint">{hint}</span>}
    </label>
  );
}

export function Alert({
  children,
  tone = 'danger',
}: {
  children: ReactNode;
  tone?: 'danger' | 'warn';
}) {
  return (
    <p
      role="alert"
      className={
        tone === 'danger'
          ? 'text-sm text-danger'
          : 'rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-sm text-warn'
      }
    >
      {children}
    </p>
  );
}
