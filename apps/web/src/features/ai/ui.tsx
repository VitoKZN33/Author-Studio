'use client';

import type { ReactNode } from 'react';
import { ApiError } from '@/shared/api';
import { btn, card as kitCard, inputCls } from '@/shared/ui/kit';

export const card = `${kitCard} flex flex-col gap-3 p-4`;
export const input = inputCls;
export const primaryBtn = btn.primary;
export const secondaryBtn = btn.outline;

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
          : 'rounded-[12px] bg-warn-soft px-3 py-2 text-sm text-warn'
      }
    >
      {children}
    </p>
  );
}
