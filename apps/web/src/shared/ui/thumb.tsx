'use client';

import { useEffect, useState } from 'react';
import { fetchObjectUrl } from '../api';
import { Icon } from './icons';

/** Кэш object URL миниатюр на время сессии: списки не скачивают их повторно. */
const cache = new Map<string, Promise<string | null>>();

function load(id: string): Promise<string | null> {
  let p = cache.get(id);
  if (!p) {
    p = fetchObjectUrl(`/media/${id}/thumb`).catch(() => null);
    cache.set(id, p);
  }
  return p;
}

/** Обложка поста: миниатюра фото, значок для видео, иначе — заглушка. */
export function Thumb({
  cover,
  className = '',
}: {
  cover: { id: string; kind: 'photo' | 'video' } | null;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const id = cover?.kind === 'photo' ? cover.id : null;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void load(id).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (id && url)
    return <img src={url} alt="" className={`object-cover ${className}`} draggable={false} />;
  return (
    <div className={`grid place-items-center bg-surface-2 text-text-faint ${className}`}>
      <Icon name={cover?.kind === 'video' ? 'video' : 'image'} size={26} />
    </div>
  );
}
