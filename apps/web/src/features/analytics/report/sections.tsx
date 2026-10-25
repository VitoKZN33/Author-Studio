'use client';

import { zonedDayKey } from '@author-studio/shared';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/shared/api';
import { haptic } from '@/shared/telegram';
import { Icon } from '@/shared/ui/icons';
import { btn, inputCls } from '@/shared/ui/kit';
import { SeriesTable, SubscribersChart } from '../charts';
import { heatColor, heatIndex, heatText } from '../types';
import { Bars, Card, CardTitle, Cell, Cells, Note, Section } from './ui';
import { num, signedNum, type Change, type Report, type ReportPost } from './types';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const SLOTS = ['0–3', '3–6', '6–9', '9–12', '12–15', '15–18', '18–21', '21–24'];

function changeText(c: Change | null) {
  return c ? signedNum(c.delta) : '—';
}
const changePct = (c: Change | null) =>
  c && c.pct !== null
    ? `${c.delta < 0 ? '−' : c.delta > 0 ? '+' : ''}${num(Math.abs(c.pct))}%`
    : undefined;
const tone = (c: Change | null) =>
  c ? (c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : undefined) : undefined;

// ------------------------------------------------------------------ 1. Аудитория

export function AudienceSection({ r }: { r: Report }) {
  const t = useTranslations('analytics.report.audience');
  const format = useFormatter();
  const [table, setTable] = useState(false);
  const a = r.audience;
  const daysWithData = a.series.filter((p) => p.subscribers !== null).length;
  const postsByDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of a.markers) {
      const k = zonedDayKey(new Date(p.postedAt), r.timezone);
      m.set(k, [...(m.get(k) ?? []), p.summary]);
    }
    return m;
  }, [a.markers, r.timezone]);

  return (
    <Section id="audience" title={t('title')} kind={a.current ? 'fact' : 'none'}>
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <b className="text-[34px] leading-none font-extrabold tracking-tight tabular-nums">
            {a.current ? format.number(a.current.value) : '—'}
          </b>
          <span className="text-[12px] text-text-faint">
            {a.current
              ? t('measured', { when: format.relativeTime(new Date(a.current.measuredAt)) })
              : t('noData')}
          </span>
        </div>
        <span className="-mt-1 text-[12px] text-text-faint">{t('current')}</span>
      </Card>
      <Cells>
        <Cell
          label={t('day')}
          value={changeText(a.changes.day)}
          sub={changePct(a.changes.day)}
          tone={tone(a.changes.day)}
        />
        <Cell
          label={t('week')}
          value={changeText(a.changes.week)}
          sub={changePct(a.changes.week)}
          tone={tone(a.changes.week)}
        />
        <Cell
          label={t('month')}
          value={changeText(a.changes.month)}
          sub={changePct(a.changes.month)}
          tone={tone(a.changes.month)}
        />
      </Cells>
      {a.joins !== null ? (
        <Cells>
          <Cell label={t('joins')} value={`+${num(a.joins)}`} />
          <Cell label={t('leaves')} value={`−${num(a.leaves ?? 0)}`} />
          <Cell
            label={t('net')}
            value={signedNum(a.net ?? 0)}
            tone={(a.net ?? 0) > 0 ? 'up' : (a.net ?? 0) < 0 ? 'down' : undefined}
          />
        </Cells>
      ) : (
        <Note>{t('noEvents')}</Note>
      )}
      <Card>
        <CardTitle
          right={
            daysWithData >= 2 && (
              <button
                type="button"
                onClick={() => setTable((v) => !v)}
                className="text-xs font-semibold text-accent"
              >
                {table ? t('chart') : t('table')}
              </button>
            )
          }
        >
          {t('history')}
        </CardTitle>
        {daysWithData < 2 ? (
          <Note>{t('historyLater')}</Note>
        ) : table ? (
          <SeriesTable series={a.series} />
        ) : (
          <SubscribersChart series={a.series} postsByDay={postsByDay} />
        )}
      </Card>
    </Section>
  );
}

// ------------------------------------------------------------------ 2. Охваты

function NoViews() {
  const t = useTranslations('analytics.report.reach');
  return (
    <Link
      href="/views/"
      className="flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-border-strong px-3.5 py-3 text-sm"
    >
      <Icon name="eye" className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-text-muted">{t('noViews')}</span>
      <Icon name="chevron" size={16} className="text-text-faint" />
    </Link>
  );
}

export function ReachSection({
  r,
  channelId,
  onChanged,
}: {
  r: Report;
  channelId: string;
  onChanged: () => void;
}) {
  const t = useTranslations('analytics.report.reach');
  const [all, setAll] = useState(false);
  const x = r.reach;
  const posts = all ? x.posts : x.posts.slice(0, 5);
  return (
    <Section id="reach" title={t('title')} kind={x.postsWithViews ? 'fact' : 'none'}>
      {x.postsWithViews === 0 && <NoViews />}
      <Cells>
        <Cell label={t('avgViews')} value={num(x.avgViews)} />
        <Cell label={t('totalViews')} value={num(x.totalViews)} />
        <Cell label={t('reach')} value={num(x.avgReachPct, '%')} />
        <Cell label={t('avgForwards')} value={num(x.avgForwards)} />
        <Cell label={t('avgReactions')} value={num(x.avgReactions)} />
        <Cell label={t('measuredPosts')} value={`${x.postsWithViews} / ${x.posts.length}`} />
      </Cells>
      {x.avgReachPct !== null && x.avgReachPct > 100 && <Note>{t('reachOver')}</Note>}
      {x.posts.length > 0 && (
        <Card className="gap-0 p-0">
          <div className="px-3.5 pt-3 pb-1">
            <CardTitle>{t('posts')}</CardTitle>
          </div>
          <ul className="divide-y divide-border">
            {posts.map((p) => (
              <PostRow
                key={p.key}
                p={p}
                tz={r.timezone}
                channelId={channelId}
                onChanged={onChanged}
              />
            ))}
          </ul>
          {x.posts.length > 5 && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="px-3.5 py-2.5 text-left text-sm font-semibold text-accent"
            >
              {all ? t('less') : t('more', { n: x.posts.length })}
            </button>
          )}
        </Card>
      )}
    </Section>
  );
}

function PostRow({
  p,
  tz,
  channelId,
  onChanged,
}: {
  p: ReportPost;
  tz: string;
  channelId: string;
  onChanged: () => void;
}) {
  const t = useTranslations('analytics.report.reach');
  const format = useFormatter();
  const [edit, setEdit] = useState(false);
  const [views, setViews] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/analytics/channels/${channelId}/manual`, {
        messageId: p.messageId,
        views: Number(views),
      });
      haptic('success');
      setEdit(false);
      onChanged();
    } catch {
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1.5 px-3.5 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[14px] font-semibold">
          {p.isAd && (
            <span className="mr-1.5 rounded bg-warn-soft px-1 text-[10.5px] font-bold text-warn">
              {t('ad')}
            </span>
          )}
          {p.summary}
        </p>
        <span className="shrink-0 text-[11.5px] text-text-faint">
          {format.dateTime(new Date(p.postedAt), {
            timeZone: tz,
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-text-muted">
        <span>
          {t('views')}: <b className="text-text tabular-nums">{num(p.views)}</b>
        </span>
        <span>
          {t('reachShort')}: <b className="text-text tabular-nums">{num(p.reachPct, '%')}</b>
        </span>
        <span>
          {t('reactions')}: <b className="text-text tabular-nums">{num(p.reactions)}</b>
        </span>
        <span>
          {t('forwards')}: <b className="text-text tabular-nums">{num(p.forwards)}</b>
        </span>
        {p.views === null && !edit && (
          <button type="button" onClick={() => setEdit(true)} className="font-semibold text-accent">
            {t('enter')}
          </button>
        )}
      </div>
      {edit && (
        <form onSubmit={(e) => void save(e)} className="flex gap-2">
          <input
            className={`${inputCls} min-h-9 w-32`}
            inputMode="numeric"
            placeholder={t('views')}
            value={views}
            onChange={(e) => setViews(e.target.value.replace(/\D/g, ''))}
          />
          <button
            type="submit"
            disabled={busy || !views}
            className={`${btn.primary} min-h-9 text-sm`}
          >
            {t('save')}
          </button>
          <button type="button" onClick={() => setEdit(false)} className="text-sm text-text-muted">
            {t('cancel')}
          </button>
        </form>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ 3. Вовлечённость

export function EngagementSection({ r }: { r: Report }) {
  const t = useTranslations('analytics.report.engagement');
  const e = r.engagement;
  return (
    <Section
      id="engagement"
      title={t('title')}
      kind={e.avgReactions !== null ? 'estimate' : 'none'}
    >
      <Cells cols={2}>
        <Cell label={t('avgReactions')} value={num(e.avgReactions)} />
        <Cell label={t('avgForwards')} value={num(e.avgForwards)} />
        <Cell label={t('reactionRate')} value={num(e.reactionRatePct, '%')} />
        <Cell label={t('forwardRate')} value={num(e.forwardRatePct, '%')} />
      </Cells>
      <Note>{e.postsMeasured ? t('note', { n: e.postsMeasured }) : t('needViews')}</Note>
    </Section>
  );
}

// ------------------------------------------------------------------ 4. Эффективность

export function EffectivenessSection({ r }: { r: Report }) {
  const t = useTranslations('analytics.report.effect');
  const e = r.effectiveness;
  const bt = e.bestTime;
  const max = Math.max(0, ...bt.cells.map((c) => c.avg ?? 0));
  const metricName = t(`metric.${e.metric}`);
  const s = e.schedule;

  return (
    <Section id="effect" title={t('title')} kind="estimate">
      <Card>
        <CardTitle>{t('bestTime')}</CardTitle>
        <p className="text-[13px] text-text-muted">
          {bt.best
            ? t('bestResult', {
                day: WEEKDAYS[bt.best.weekday]!,
                slot: SLOTS[bt.best.slot]!,
                avg: num(bt.best.avg),
                overall: num(bt.overallAvg),
                metric: metricName,
                n: bt.best.n,
              })
            : t('bestInsufficient', { total: bt.total })}
        </p>
        <table className="w-full table-fixed border-separate border-spacing-[2px] text-[10.5px]">
          <thead>
            <tr>
              <th className="w-6" />
              {SLOTS.map((x) => (
                <th key={x} className="font-normal text-text-faint">
                  {x.split('–')[0]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((d, w) => (
              <tr key={d}>
                <th className="text-left font-normal text-text-faint">{d}</th>
                {SLOTS.map((_, slot) => {
                  const c = bt.cells.find((x) => x.weekday === w && x.slot === slot);
                  const i = c?.n ? heatIndex(c.avg ?? 0, max) : null;
                  return (
                    <td
                      key={slot}
                      title={c?.n ? t('cell', { avg: num(c.avg), n: c.n }) : ''}
                      className="h-6 rounded-[5px] text-center font-bold tabular-nums"
                      style={{
                        background: i !== null ? heatColor(i) : 'var(--color-surface-2)',
                        color: i !== null ? heatText(i) : 'transparent',
                      }}
                    >
                      {c?.n || ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <Note>{t('heatNote', { metric: metricName })}</Note>
      </Card>

      <Card>
        <CardTitle>{t('byWeekday', { metric: metricName })}</CardTitle>
        <Bars
          rows={e.byWeekday
            .filter((d) => d.posts > 0)
            .map((d) => ({
              label: WEEKDAYS[d.weekday]!,
              value: d.avg,
              hint: t('posts', { n: d.posts }),
              muted: d.posts < 3,
            }))}
        />
        <CardTitle>{t('bySlot', { metric: metricName })}</CardTitle>
        <Bars
          rows={e.bySlot
            .filter((d) => d.posts > 0)
            .map((d) => ({
              label: SLOTS[d.slot]!,
              value: d.avg,
              hint: t('posts', { n: d.posts }),
              muted: d.posts < 3,
            }))}
        />
        <Note>{t('mutedNote')}</Note>
      </Card>

      <Card>
        <CardTitle>{t('plan.title')}</CardTitle>
        <Cells>
          <Cell label={t('plan.planned')} value={num(s.planned)} />
          <Cell label={t('plan.onTime')} value={num(s.onTime)} tone={s.onTime ? 'up' : undefined} />
          <Cell label={t('plan.late')} value={num(s.late)} />
          <Cell
            label={t('plan.failed')}
            value={num(s.failed)}
            tone={s.failed ? 'down' : undefined}
          />
          <Cell label={t('plan.immediate')} value={num(s.immediate)} />
          <Cell label={t('plan.outside')} value={num(s.outsideApp)} />
        </Cells>
        <Note>
          {s.avgDelayMin !== null ? t('plan.delay', { min: num(s.avgDelayMin) }) : t('plan.noPlan')}
        </Note>
      </Card>
    </Section>
  );
}

// ------------------------------------------------------------------ 5. Реклама

export function AdsSection({ r }: { r: Report }) {
  const t = useTranslations('analytics.report.ads');
  const format = useFormatter();
  const a = r.ads;
  return (
    <Section id="ads" title={t('title')} kind={a.count ? 'fact' : 'none'}>
      <Cells>
        <Cell label={t('count')} value={num(a.count)} />
        <Cell
          label={t('avgViews')}
          value={num(a.avgViews)}
          sub={
            a.regularAvgViews !== null ? t('vsRegular', { n: num(a.regularAvgViews) }) : undefined
          }
        />
        <Cell label={t('reach')} value={num(a.avgReachPct, '%')} />
      </Cells>
      {a.posts.length > 0 && (
        <Card className="gap-0 p-0">
          <ul className="divide-y divide-border">
            {a.posts.map((p) => (
              <li
                key={p.key}
                className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[13px]"
              >
                <span className="min-w-0 truncate font-semibold">{p.summary}</span>
                <span className="shrink-0 text-text-muted tabular-nums">
                  {num(p.views)} · {num(p.reachPct, '%')} ·{' '}
                  {format.dateTime(new Date(p.postedAt), {
                    timeZone: r.timezone,
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Note>{t('how')}</Note>
    </Section>
  );
}

// ------------------------------------------------------------------ 6. Переходы

export function LinksSection({
  r,
  channelId,
  onChanged,
}: {
  r: Report;
  channelId: string;
  onChanged: () => void;
}) {
  const t = useTranslations('analytics.report.links');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('https://');
  const [isAd, setIsAd] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ shortUrl: string }>('/links', {
        title,
        targetUrl: url,
        channelId,
        isAd,
      });
      haptic('success');
      await copy(res.shortUrl);
      setOpen(false);
      setTitle('');
      setUrl('https://');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      setCopied(null);
    }
  }

  async function remove(id: string) {
    await api.del(`/links/${id}`).catch(() => undefined);
    onChanged();
  }

  return (
    <Section id="links" title={t('title')} kind={r.links.items.length ? 'measured' : 'none'}>
      <Cells cols={2}>
        <Cell label={t('clicks', { d: r.days })} value={num(r.links.clicks)} />
        <Cell label={t('unique')} value={num(r.links.unique)} />
      </Cells>
      {r.links.items.length > 0 && (
        <Card className="gap-0 p-0">
          <ul className="divide-y divide-border">
            {r.links.items.map((l) => (
              <li key={l.id} className="flex flex-col gap-1 px-3.5 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[14px] font-semibold">
                    {l.isAd && (
                      <span className="mr-1.5 rounded bg-warn-soft px-1 text-[10.5px] font-bold text-warn">
                        {t('ad')}
                      </span>
                    )}
                    {l.title}
                  </p>
                  <span className="shrink-0 text-[13px] font-bold tabular-nums">
                    {num(l.period?.clicks ?? 0)}
                    <span className="font-normal text-text-faint"> / {num(l.total.clicks)}</span>
                  </span>
                </div>
                <p className="truncate text-[12px] text-text-faint">{l.targetUrl}</p>
                <div className="flex items-center gap-3 text-[12.5px]">
                  <button
                    type="button"
                    onClick={() => void copy(l.shortUrl)}
                    className="flex items-center gap-1 font-semibold text-accent"
                  >
                    <Icon name="copy" size={14} />
                    {copied === l.shortUrl ? t('copied') : l.shortUrl.replace(/^https?:\/\//, '')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(l.id)}
                    className="ml-auto text-text-faint"
                  >
                    {t('remove')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {open ? (
        <Card>
          <form onSubmit={(e) => void create(e)} className="flex flex-col gap-2.5">
            <input
              className={inputCls}
              placeholder={t('titlePlaceholder')}
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className={inputCls}
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-accent)]"
                checked={isAd}
                onChange={(e) => setIsAd(e.target.checked)}
              />
              {t('isAd')}
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || !title.trim() || url.length < 10}
                className={btn.primary}
              >
                {t('create')}
              </button>
              <button type="button" onClick={() => setOpen(false)} className={btn.outline}>
                {t('cancel')}
              </button>
            </div>
          </form>
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`${btn.outline} self-start text-sm`}
        >
          <Icon name="plus" size={16} />
          {t('new')}
        </button>
      )}
      <Note>{t('how')}</Note>
    </Section>
  );
}
