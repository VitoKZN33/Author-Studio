'use client';

import { useTranslations } from 'next-intl';
import { heatColor, heatText, type BestTime } from './types';

const SLOTS = ['0–3', '3–6', '6–9', '9–12', '12–15', '15–18', '18–21', '21–24'];

/** Сетка «день недели × время»: средний показатель и число постов в каждой ячейке. */
export function BestTimeGrid({
  data,
  onMetric,
}: {
  data: BestTime;
  onMetric: (m: 'reactions' | 'views') => void;
}) {
  const t = useTranslations('analytics.bestTime');
  const days = t.raw('weekdays') as string[];
  const max = Math.max(0, ...data.cells.map((c) => c.avg ?? 0));
  const cell = (w: number, s: number) => data.cells.find((c) => c.weekday === w && c.slot === s)!;

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t('title')}</h2>
        <select
          value={data.metric}
          onChange={(e) => onMetric(e.target.value as 'reactions' | 'views')}
          aria-label={t('metric')}
          className="min-h-9 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-2 text-sm"
        >
          <option value="reactions">{t('byReactions')}</option>
          <option value="views">{t('byViews')}</option>
        </select>
      </div>

      <p className="text-sm leading-relaxed text-text-muted">
        {data.confidence === 'insufficient'
          ? t('insufficient', { total: data.total, needed: 15 })
          : t('result', {
              day: days[data.best!.weekday]!,
              slot: SLOTS[data.best!.slot]!,
              avg: data.best!.avg ?? 0,
              overall: data.overallAvg ?? 0,
              n: data.best!.n,
              total: data.total,
            })}
      </p>
      {data.confidence !== 'insufficient' && (
        <p className="text-xs text-text-faint">{t(`confidence.${data.confidence}`)}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-0.5 text-[11px]">
          <thead>
            <tr>
              <th className="w-8" />
              {SLOTS.map((s) => (
                <th key={s} className="pb-1 font-normal text-text-faint">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d, w) => (
              <tr key={d}>
                <th className="pr-1 text-left font-normal text-text-faint">{d}</th>
                {SLOTS.map((_, s) => {
                  const c = cell(w, s);
                  const isBest = data.best && data.best.weekday === w && data.best.slot === s;
                  const bg = c.n ? heatColor(c.avg ?? 0, max) : null;
                  return (
                    <td
                      key={s}
                      title={c.n ? t('cellTitle', { avg: c.avg ?? 0, n: c.n }) : t('cellEmpty')}
                      className={`h-8 rounded text-center font-semibold tabular-nums ${isBest ? 'outline outline-2 outline-text' : ''}`}
                      style={{
                        background: bg ?? 'var(--color-surface-2)',
                        color: bg ? heatText(bg) : 'var(--color-text-faint)',
                      }}
                    >
                      {c.n ? c.n : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-faint">
        {t('legend', { tz: data.timezone, days: data.days })}
      </p>
    </section>
  );
}
