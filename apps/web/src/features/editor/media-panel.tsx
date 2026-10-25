'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ApiError, fetchObjectUrl, uploadFile } from '@/shared/api';
import { Icon } from '@/shared/ui/icons';
import { Thumb } from '@/shared/ui/thumb';
import type { MediaView } from '../posts/types';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';

/** Миниатюра медиафайла: файл доступен только с токеном, поэтому через object URL. */
export function MediaThumb({ media, className }: { media: MediaView; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    void fetchObjectUrl(`/media/${media.id}`)
      .then((u) => {
        objectUrl = u;
        if (!revoked) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => undefined);
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.id]);

  if (!url) return <div className={`animate-pulse bg-surface-2 ${className ?? ''}`} />;
  return media.kind === 'video' ? (
    <video
      src={url}
      muted
      playsInline
      preload="metadata"
      className={`object-cover ${className ?? ''}`}
    />
  ) : (
    <img src={url} alt="" className={`object-cover ${className ?? ''}`} />
  );
}

interface Uploading {
  key: string;
  name: string;
  share: number;
  error?: string;
}

interface Props {
  items: MediaView[];
  onChange: (items: MediaView[]) => void;
}

export function MediaPanel({ items, onChange }: Props) {
  const t = useTranslations('editor.media');
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Uploading[]>([]);
  // Актуальный список для завершения загрузок, начатых до последних изменений.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  async function onFiles(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setUploads((u) => [...u, { key, name: file.name, share: 0 }]);
      try {
        const media = await uploadFile<MediaView>('/media', file, (share) =>
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, share } : x))),
        );
        onChange([...itemsRef.current, media]);
        setUploads((u) => u.filter((x) => x.key !== key));
      } catch (e) {
        const error = e instanceof ApiError ? e.message : t('failed');
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, error } : x)));
      }
    }
    if (input.current) input.current.value = '';
  }

  function move(index: number, delta: number) {
    const next = [...items];
    const [m] = next.splice(index, 1);
    next.splice(index + delta, 0, m!);
    onChange(next);
  }

  return (
    <section className="flex flex-col gap-2" aria-label={t('title')}>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => void onFiles(e.target.files)}
      />
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {items.map((m, i) => (
          <li
            key={m.id}
            className="relative size-[84px] shrink-0 overflow-hidden rounded-[14px] bg-surface-2"
          >
            {m.kind === 'photo' ? (
              <Thumb cover={{ id: m.id, kind: 'photo' }} className="size-full" />
            ) : (
              <MediaThumb media={m} className="size-full" />
            )}
            {m.kind === 'video' && (
              <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 text-[10.5px] font-bold text-white">
                {t('video')}
              </span>
            )}
            <button
              type="button"
              aria-label={t('remove')}
              onClick={() => onChange(items.filter((x) => x.id !== m.id))}
              className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white"
            >
              <Icon name="close" size={14} strokeWidth={2.4} />
            </button>
            {items.length > 1 && (
              <div className="absolute inset-x-1 bottom-1 flex justify-end gap-1">
                <IconBtn label={t('left')} disabled={i === 0} onClick={() => move(i, -1)}>
                  ‹
                </IconBtn>
                <IconBtn
                  label={t('right')}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ›
                </IconBtn>
              </div>
            )}
          </li>
        ))}
        {uploads.map((u) => (
          <li
            key={u.key}
            className="relative grid size-[84px] shrink-0 place-items-center rounded-[14px] bg-surface-2 p-2 text-center text-[11px]"
          >
            {u.error ? (
              <button
                type="button"
                className="text-danger"
                title={u.error}
                onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}
              >
                {t('failedShort')}
              </button>
            ) : (
              <span className="font-bold text-accent">{Math.round(u.share * 100)}%</span>
            )}
          </li>
        ))}
        {items.length < 10 && (
          <li className="shrink-0">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="grid size-[84px] place-items-center rounded-[14px] border-[1.5px] border-dashed border-border-strong text-center text-[12px] leading-tight text-text-muted"
            >
              <span>
                <Icon name="plus" size={20} className="mx-auto mb-1" />
                {t('addShort')}
              </span>
            </button>
          </li>
        )}
      </ul>
      {uploads
        .filter((u) => u.error)
        .map((u) => (
          <p key={u.key} role="alert" className="text-sm text-danger">
            {u.name}: {u.error}
          </p>
        ))}
    </section>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-6 place-items-center rounded-full bg-black/60 text-base leading-none text-white disabled:opacity-30"
    >
      {children}
    </button>
  );
}
