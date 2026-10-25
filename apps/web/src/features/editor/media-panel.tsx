'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ApiError, fetchObjectUrl, uploadFile } from '@/shared/api';
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
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-muted">
          {t('title')} <span className="text-text-faint">{items.length}/10</span>
        </h2>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={items.length >= 10}
          className="min-h-9 rounded-[var(--radius-control)] border border-border-strong px-3 text-sm text-text-muted hover:text-text disabled:opacity-40"
        >
          {t('add')}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>

      {items.length === 0 && uploads.length === 0 && (
        <p className="text-sm text-text-faint">{t('empty')}</p>
      )}

      {items.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((m, i) => (
            <li
              key={m.id}
              className="relative overflow-hidden rounded-[var(--radius-control)] border border-border"
            >
              <MediaThumb media={m} className="aspect-square w-full" />
              {m.kind === 'video' && (
                <span className="absolute top-1 left-1 rounded bg-bg/80 px-1.5 text-[11px]">
                  {t('video')}
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-bg/80">
                <IconBtn label={t('left')} disabled={i === 0} onClick={() => move(i, -1)}>
                  ‹
                </IconBtn>
                <IconBtn
                  label={t('remove')}
                  onClick={() => onChange(items.filter((x) => x.id !== m.id))}
                >
                  ×
                </IconBtn>
                <IconBtn
                  label={t('right')}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ›
                </IconBtn>
              </div>
            </li>
          ))}
        </ul>
      )}

      {uploads.map((u) => (
        <div
          key={u.key}
          className="rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm"
        >
          <div className="flex justify-between gap-3">
            <span className="truncate text-text-muted">{u.name}</span>
            {u.error ? (
              <button
                type="button"
                className="text-text-faint"
                onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}
              >
                ×
              </button>
            ) : (
              <span className="text-text-faint">{Math.round(u.share * 100)}%</span>
            )}
          </div>
          {u.error ? (
            <p role="alert" className="mt-1 text-danger">
              {u.error}
            </p>
          ) : (
            <div className="mt-1.5 h-1 overflow-hidden rounded bg-surface-2">
              <div className="h-full bg-accent" style={{ width: `${u.share * 100}%` }} />
            </div>
          )}
        </div>
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
      className="h-8 flex-1 text-lg leading-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
