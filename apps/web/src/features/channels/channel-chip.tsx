'use client';

import type { Channel } from './types';

/** Канал в шапке экрана: «таблетка» с буквой; при нескольких каналах — выбор. */
export function ChannelChip({
  channels,
  selected,
  onSelect,
}: {
  channels: Channel[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const current = channels.find((c) => c.id === selected);
  if (!current) return null;
  const letter = (current.title.trim()[0] ?? '?').toUpperCase();
  return (
    <label className="relative flex max-w-[55%] min-w-0 items-center gap-2 rounded-full border border-border bg-surface py-1 pr-3 pl-1 text-sm font-semibold">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-[13px] text-on-accent">
        {letter}
      </span>
      <span className="truncate">{current.title}</span>
      {channels.length > 1 && (
        <>
          <span aria-hidden className="text-text-faint">
            ▾
          </span>
          <select
            aria-label="Канал"
            value={selected}
            onChange={(e) => onSelect(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </>
      )}
    </label>
  );
}
