'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState, type PointerEvent } from 'react';
import { signed, type DayPoint } from './types';
import { useWidth } from './use-width';

const LINE = '#3987e5';
const JOIN = '#3987e5';
const LEAVE = '#e66767';
const GRID = 'var(--color-border)';
const H = 200;
const PAD = { top: 14, right: 12, bottom: 26, left: 46 };

function niceDomain(values: number[]): [number, number] {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.12;
  return [Math.floor(min - pad), Math.ceil(max + pad)];
}

function dayLabel(format: ReturnType<typeof useFormatter>, day: string) {
  return format.dateTime(new Date(`${day}T12:00:00Z`), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function useHover(count: number, width: number) {
  const [index, setIndex] = useState<number | null>(null);
  const plotW = width - PAD.left - PAD.right;
  const step = count > 1 ? plotW / (count - 1) : 0;
  const x = (i: number) => PAD.left + (count > 1 ? i * step : plotW / 2);
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * plotW;
    setIndex(Math.max(0, Math.min(count - 1, Math.round(count > 1 ? px / step : 0))));
  };
  return { index, setIndex, x, plotW, onMove };
}

/** Число подписчиков по дням: линия с разрывами там, где измерений не было. */
export function SubscribersChart({
  series,
  postsByDay,
}: {
  series: DayPoint[];
  postsByDay: Map<string, string[]>;
}) {
  const t = useTranslations('analytics.chart');
  const format = useFormatter();
  const { ref, width } = useWidth<HTMLDivElement>();
  const { index, setIndex, x, plotW, onMove } = useHover(series.length, width);
  const values = series.flatMap((p) => (p.subscribers === null ? [] : [p.subscribers]));

  if (values.length === 0) {
    return (
      <div ref={ref} className="grid h-[200px] place-items-center text-sm text-text-faint">
        {t('noData')}
      </div>
    );
  }

  const [lo, hi] = niceDomain(values);
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const ticks = [lo, Math.round((lo + hi) / 2), hi];

  // Отрезки линии между соседними днями с данными; одиночные точки — кружком.
  const segments: string[] = [];
  let current: string[] = [];
  series.forEach((p, i) => {
    if (p.subscribers === null) {
      if (current.length) segments.push(current.join(' '));
      current = [];
    } else
      current.push(
        `${current.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.subscribers).toFixed(1)}`,
      );
  });
  if (current.length) segments.push(current.join(' '));
  const isolated = series
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p, i }) =>
        p.subscribers !== null &&
        series[i - 1]?.subscribers == null &&
        series[i + 1]?.subscribers == null,
    );

  const hovered = index !== null ? series[index] : null;
  const hoveredPosts = hovered ? (postsByDay.get(hovered.day) ?? []) : [];
  const labelIdx = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={t('subscribersAria')}
        className="block select-none"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke={GRID}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-text-faint text-[11px]"
            >
              {v}
            </text>
          </g>
        ))}
        {labelIdx.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
            className="fill-text-faint text-[11px]"
          >
            {dayLabel(format, series[i]!.day)}
          </text>
        ))}
        {series.map((p, i) =>
          postsByDay.has(p.day) ? (
            <rect
              key={`m${p.day}`}
              x={x(i) - 1}
              y={PAD.top + plotH - 6}
              width={2}
              height={6}
              rx={1}
              className="fill-text-muted"
            />
          ) : null,
        )}
        {segments.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={LINE}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {isolated.map(({ p, i }) => (
          <circle
            key={p.day}
            cx={x(i)}
            cy={y(p.subscribers!)}
            r={4}
            fill={LINE}
            stroke="var(--color-surface)"
            strokeWidth={2}
          />
        ))}
        {hovered && index !== null && (
          <g pointerEvents="none">
            <line
              x1={x(index)}
              x2={x(index)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
            />
            {hovered.subscribers !== null && (
              <circle
                cx={x(index)}
                cy={y(hovered.subscribers)}
                r={5}
                fill={LINE}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            )}
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setIndex(null)}
        />
      </svg>
      {hovered && index !== null && (
        <Tooltip x={x(index)} width={width}>
          <div className="text-text-muted">{dayLabel(format, hovered.day)}</div>
          <div className="text-text">
            {hovered.subscribers !== null
              ? t('subscribers', { value: hovered.subscribers })
              : t('noMeasurement')}
          </div>
          {hovered.change !== null && (
            <div className="text-text-muted">{t('change', { value: signed(hovered.change) })}</div>
          )}
          {hoveredPosts.length > 0 && (
            <div className="mt-1 border-t border-border pt-1 text-text-muted">
              {t('posts', { count: hoveredPosts.length })}: {hoveredPosts[0]}
            </div>
          )}
        </Tooltip>
      )}
    </div>
  );
}

/** Вступления (вверх) и выходы (вниз) по дням — расходящиеся столбики от нуля. */
export function MembersChart({ series }: { series: DayPoint[] }) {
  const t = useTranslations('analytics.chart');
  const format = useFormatter();
  const { ref, width } = useWidth<HTMLDivElement>();
  const { index, setIndex, x, plotW, onMove } = useHover(series.length, width);
  const max = Math.max(1, ...series.map((p) => Math.max(p.joins ?? 0, p.leaves ?? 0)));
  const plotH = H - PAD.top - PAD.bottom;
  const mid = PAD.top + plotH / 2;
  const scale = (v: number) => (v / max) * (plotH / 2 - 2);
  const bw = Math.max(2, Math.min(14, plotW / Math.max(series.length, 1) - 4));
  const hovered = index !== null ? series[index] : null;
  const labelIdx = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];

  return (
    <div ref={ref} className="relative">
      <div className="mb-2 flex gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: JOIN }} />
          {t('joins')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: LEAVE }} />
          {t('leaves')}
        </span>
      </div>
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={t('membersAria')}
        className="block select-none"
      >
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={mid}
          y2={mid}
          stroke="var(--color-border-strong)"
          strokeWidth={1}
        />
        <text
          x={PAD.left - 8}
          y={PAD.top + 8}
          textAnchor="end"
          className="fill-text-faint text-[11px]"
        >
          +{max}
        </text>
        <text
          x={PAD.left - 8}
          y={PAD.top + plotH}
          textAnchor="end"
          className="fill-text-faint text-[11px]"
        >
          −{max}
        </text>
        {series.map((p, i) => {
          if (p.joins === null) return null;
          const jh = scale(p.joins);
          const lh = scale(p.leaves ?? 0);
          return (
            <g key={p.day} opacity={index === null || index === i ? 1 : 0.55}>
              {jh > 0 && (
                <rect
                  x={x(i) - bw / 2}
                  y={mid - jh - 1}
                  width={bw}
                  height={jh}
                  rx={Math.min(4, bw / 2)}
                  fill={JOIN}
                />
              )}
              {lh > 0 && (
                <rect
                  x={x(i) - bw / 2}
                  y={mid + 1}
                  width={bw}
                  height={lh}
                  rx={Math.min(4, bw / 2)}
                  fill={LEAVE}
                />
              )}
            </g>
          );
        })}
        {labelIdx.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
            className="fill-text-faint text-[11px]"
          >
            {dayLabel(format, series[i]!.day)}
          </text>
        ))}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setIndex(null)}
        />
      </svg>
      {hovered && index !== null && (
        <Tooltip x={x(index)} width={width}>
          <div className="text-text-muted">{dayLabel(format, hovered.day)}</div>
          {hovered.joins === null ? (
            <div className="text-text-faint">{t('noEvents')}</div>
          ) : (
            <>
              <div>{t('joinsValue', { value: hovered.joins })}</div>
              <div>{t('leavesValue', { value: hovered.leaves ?? 0 })}</div>
            </>
          )}
        </Tooltip>
      )}
    </div>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x - 90, 4), width - 184);
  return (
    <div
      className="pointer-events-none absolute top-0 w-[180px] rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-2.5 py-2 text-xs leading-relaxed shadow-lg"
      style={{ left }}
    >
      {children}
    </div>
  );
}

/** Табличное представление ряда — доступная альтернатива графикам. */
export function SeriesTable({ series }: { series: DayPoint[] }) {
  const t = useTranslations('analytics.chart');
  const format = useFormatter();
  const dash = '—';
  return (
    <div className="max-h-72 overflow-auto rounded-[var(--radius-control)] border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface-2 text-left text-xs text-text-muted">
          <tr>
            <th className="px-3 py-2 font-normal">{t('day')}</th>
            <th className="px-3 py-2 text-right font-normal">{t('subscribersCol')}</th>
            <th className="px-3 py-2 text-right font-normal">{t('changeCol')}</th>
            <th className="px-3 py-2 text-right font-normal">{t('joins')}</th>
            <th className="px-3 py-2 text-right font-normal">{t('leaves')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {[...series].reverse().map((p) => (
            <tr key={p.day}>
              <td className="px-3 py-1.5 text-text-muted">{dayLabel(format, p.day)}</td>
              <td className="px-3 py-1.5 text-right">{p.subscribers ?? dash}</td>
              <td className="px-3 py-1.5 text-right">
                {p.change === null ? dash : signed(p.change)}
              </td>
              <td className="px-3 py-1.5 text-right">{p.joins ?? dash}</td>
              <td className="px-3 py-1.5 text-right">{p.leaves ?? dash}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
