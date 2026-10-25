'use client';

import { useEffect, useState } from 'react';
import { api } from '@/shared/api';
import type { Channel } from './types';

const KEY = 'as.channel';

function readSaved(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Подключённые каналы и выбранный канал (запоминается на устройстве — удобство,
 * не состояние: при пустом хранилище берётся первый канал).
 */
export function useChannels() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: Channel[] }>('/channels')
      .then((r) => {
        if (cancelled) return;
        const list = r.items.filter((c) => c.status !== 'detected' && c.status !== 'disconnected');
        setChannels(list);
        const saved = readSaved();
        setSelected(list.find((c) => c.id === saved)?.id ?? list[0]?.id ?? '');
      })
      .catch(() => !cancelled && setChannels([]));
    return () => {
      cancelled = true;
    };
  }, []);

  function select(id: string) {
    setSelected(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // хранилище недоступно — выбор действует до закрытия
    }
  }

  return { channels, selected, select, channel: channels?.find((c) => c.id === selected) ?? null };
}
