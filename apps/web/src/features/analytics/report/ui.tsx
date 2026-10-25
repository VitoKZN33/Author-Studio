'use client';

import type { ReactNode } from 'react';
import { KindTag } from '../value-kind';
import type { ValueKind } from '../types';

/** Раздел отчёта: заголовок с номером-якорем и пометкой источника. */
export function Section({
  title,
  kind,
  children,
  id,
}: {
  title: string;
  kind?: ValueKind;
  children: ReactNode;
  id: string;
}) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <h2 className="text-[17px] font-extrabold tracking-tight">{title}</h2>
        {kind && <KindTag kind={kind} />}
      </div>
      {children}
    </section>
  );
}

/** Сетка компактных значений. */
export function Cells({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }[cols];
  return (
    <div
      className={`grid ${c} gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border`}
    >
      {children}
    </div>
  );
}

export function Cell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'up' | 'down';
}) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2.5">
      <div
        className={`text-[18px] leading-tight font-extrabold tracking-tight tabular-nums [overflow-wrap:anywhere] ${tone === 'up' ? 'text-ok' : tone === 'down' ? 'text-danger' : ''}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11.5px] leading-tight text-text-faint">{label}</div>
      {sub && <div className="text-[11.5px] leading-tight text-text-muted">{sub}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3.5 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[14px] font-bold">{children}</h3>
      {right}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[12px] leading-snug text-text-faint">{children}</p>;
}

/** Горизонтальные полосы «метка — значение» (для сравнений). */
export function Bars({
  rows,
}: {
  rows: { label: string; value: number | null; hint?: string; muted?: boolean }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2 text-[13px]"
        >
          <span className={`truncate ${r.muted ? 'text-text-faint' : ''}`}>{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-2">
            {r.value !== null && (
              <span
                className={`block h-full rounded-full ${r.muted ? 'bg-border-strong' : 'bg-[var(--chart-1)]'}`}
                style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }}
              />
            )}
          </span>
          <span className="text-right text-[12px] text-text-muted tabular-nums">
            {r.value === null ? '—' : new Intl.NumberFormat('ru-RU').format(r.value)}
            {r.hint ? <span className="text-text-faint">, {r.hint}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
