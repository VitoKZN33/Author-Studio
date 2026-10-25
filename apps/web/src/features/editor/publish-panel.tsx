'use client';

import {
  utcToZonedWallTime,
  zonedDayKey,
  zonedWallTimeToUtc,
  type ContentProblem,
} from '@author-studio/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { btn, inputCls, Segmented } from '@/shared/ui/kit';
import { haptic } from '@/shared/telegram';
import type { Channel } from '../channels/types';
import type { PublicationView } from '../posts/types';

interface Props {
  postId: string;
  channels: Channel[];
  timezone: string;
  problems: ContentProblem[];
  /** Сохраняет черновик и возвращает актуальную версию (null — сохранить не удалось). */
  saveNow: () => Promise<number | null>;
  onPublished: (items: PublicationView[]) => void;
}

interface Slot {
  key: string;
  wall: string;
  best?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Ближайший момент со стенным временем hh:00 в поясе установки, позже чем через 10 минут. */
function nextWall(dayOffsets: number[], hour: number, tz: string, weekday?: number): string | null {
  const now = Date.now();
  for (const off of dayOffsets) {
    const day = zonedDayKey(new Date(now + off * 86_400_000), tz);
    const wall = `${day}T${pad(hour)}:00`;
    const at = zonedWallTimeToUtc(wall, tz);
    const wd = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = пн
    if (weekday !== undefined && wd !== weekday) continue;
    if (at.getTime() > now + 10 * 60_000) return wall;
  }
  return null;
}

/**
 * Окно публикации: куда (каналы), когда (сейчас или готовые варианты времени, среди
 * которых — лучшее время по статистике канала, если данных достаточно) и одна кнопка,
 * которая называет действие целиком.
 */
export function PublishPanel({
  postId,
  channels,
  timezone,
  problems,
  saveNow,
  onPublished,
}: Props) {
  const t = useTranslations('editor.publish');
  const format = useFormatter();
  const active = channels.filter((c) => c.status === 'active');
  const [selected, setSelected] = useState<string[]>(() =>
    active.length === 1 ? [active[0]!.id] : [],
  );
  const [mode, setMode] = useState<'now' | 'later'>('later');
  const [best, setBest] = useState<{ weekday: number; slot: number } | null>(null);
  const [slotKey, setSlotKey] = useState<string>('');
  const [custom, setCustom] = useState(() =>
    utcToZonedWallTime(new Date(Date.now() + 3600_000), timezone),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bestChannel = selected[0] ?? active[0]?.id;
  useEffect(() => {
    if (!bestChannel) return;
    let cancelled = false;
    api
      .get<{ best: { weekday: number; slot: number } | null }>(
        `/analytics/channels/${bestChannel}/best-time?days=90&metric=reactions`,
      )
      .then((r) => !cancelled && setBest(r.best))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bestChannel]);

  const slots = useMemo<Slot[]>(() => {
    const list: Slot[] = [];
    const nowHour = Number(utcToZonedWallTime(new Date(), timezone).slice(11, 13));
    const today = nextWall([0], Math.max(nowHour + 1, 9), timezone);
    if (today && Number(today.slice(11, 13)) <= 21) list.push({ key: 'today', wall: today });
    const tomorrow = nextWall([1], 10, timezone);
    if (tomorrow) list.push({ key: 'tomorrow', wall: tomorrow });
    if (best) {
      const wall = nextWall([0, 1, 2, 3, 4, 5, 6, 7], best.slot * 3, timezone, best.weekday);
      if (wall && !list.some((s) => s.wall === wall))
        list.splice(Math.min(1, list.length), 0, { key: 'best', wall, best: true });
    }
    const evening = nextWall([1], 19, timezone);
    if (evening && !list.some((s) => s.wall === evening))
      list.push({ key: 'evening', wall: evening });
    return list;
  }, [best, timezone]);

  const effectiveSlot = slotKey || (slots.find((s) => s.best)?.key ?? slots[0]?.key ?? 'custom');
  const wall =
    effectiveSlot === 'custom'
      ? custom
      : (slots.find((s) => s.key === effectiveSlot)?.wall ?? custom);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const disabled =
    busy || selected.length === 0 || problems.length > 0 || (mode === 'later' && !wall);

  const fmtWall = (w: string) =>
    format.dateTime(zonedWallTimeToUtc(w, timezone), {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  const dateOnly = (w: string) =>
    format.dateTime(zonedWallTimeToUtc(w, timezone), {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let scheduledAt: string | null = null;
      if (mode === 'later') {
        const at = zonedWallTimeToUtc(wall, timezone);
        if (at.getTime() < Date.now()) throw new ApiError(400, t('pastTime'));
        scheduledAt = at.toISOString();
      }
      const version = await saveNow();
      if (version === null) throw new ApiError(409, t('saveFirst'));
      const r = await api.post<{ items: PublicationView[] }>(`/posts/${postId}/publish`, {
        channelIds: selected,
        scheduledAt,
        version,
      });
      haptic('success');
      onPublished(r.items);
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {channels.length === 0 ? (
        <p className="text-sm text-text-muted">{t('noChannels')}</p>
      ) : (
        <fieldset className="flex flex-col overflow-hidden rounded-[16px] border border-border bg-surface">
          <legend className="sr-only">{t('channels')}</legend>
          {channels.map((c) => {
            const ok = c.status === 'active';
            return (
              <label
                key={c.id}
                className={`flex min-h-12 items-center gap-3 border-b border-border px-3.5 last:border-0 ${ok ? '' : 'opacity-50'}`}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-bold text-on-accent">
                  {(c.title.trim()[0] ?? '?').toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">{c.title}</span>
                {!ok && <span className="text-xs text-text-faint">{t('unavailable')}</span>}
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--color-accent)]"
                  disabled={!ok}
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
              </label>
            );
          })}
        </fieldset>
      )}

      <Segmented
        label={t('when')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'now', label: t('now') },
          { value: 'later', label: t('later') },
        ]}
      />

      {mode === 'later' && (
        <>
          <div
            className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]"
            role="radiogroup"
          >
            {slots.map((s) => (
              <SlotBtn
                key={s.key}
                on={effectiveSlot === s.key}
                onClick={() => setSlotKey(s.key)}
                title={
                  s.key === 'today'
                    ? t('slotToday')
                    : s.key === 'tomorrow' || s.key === 'evening'
                      ? t('slotTomorrow')
                      : dateOnly(s.wall)
                }
                sub={s.best ? t('bestSub', { time: s.wall.slice(11) }) : s.wall.slice(11)}
              />
            ))}
            <SlotBtn
              on={effectiveSlot === 'custom'}
              onClick={() => setSlotKey('custom')}
              title={t('other')}
              sub={t('otherSub')}
            />
          </div>
          {effectiveSlot === 'custom' && (
            <label className="flex flex-col gap-1 text-sm text-text-muted">
              {t('dateTime', { tz: timezone })}
              <input
                type="datetime-local"
                value={custom}
                min={utcToZonedWallTime(new Date(), timezone)}
                onChange={(e) => setCustom(e.target.value)}
                className={inputCls}
              />
            </label>
          )}
          {slots.some((s) => s.best) && <p className="text-xs text-text-faint">{t('bestHint')}</p>}
        </>
      )}

      {problems.length > 0 && (
        <ul
          className="flex flex-col gap-1 rounded-[12px] bg-warn-soft px-3 py-2 text-sm text-warn"
          aria-live="polite"
        >
          {problems.map((p, i) => (
            <li key={i}>{p.message}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={disabled}
        className={`${btn.primary} min-h-12 w-full text-base`}
      >
        {busy
          ? t('busy')
          : mode === 'now'
            ? t('publishNow')
            : wall
              ? t('scheduleAt', { when: fmtWall(wall) })
              : t('schedule')}
      </button>
    </div>
  );
}

function SlotBtn({
  on,
  onClick,
  title,
  sub,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`shrink-0 rounded-[12px] px-3 py-2 text-left whitespace-nowrap ${on ? 'bg-ink text-on-ink' : 'border border-border bg-surface'}`}
    >
      <span className="block text-[13.5px] font-bold first-letter:uppercase">{title}</span>
      <span className={`block text-[11.5px] font-semibold ${on ? 'opacity-75' : 'text-accent'}`}>
        {sub}
      </span>
    </button>
  );
}
