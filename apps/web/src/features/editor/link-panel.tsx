'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { Icon } from '@/shared/ui/icons';
import { btn, inputCls } from '@/shared/ui/kit';

interface LinkItem {
  id: string;
  title: string;
  targetUrl: string;
  shortUrl: string;
  postId: string | null;
  total: { clicks: number; unique: number };
}

/**
 * Уникальная отслеживаемая ссылка для поста: короткий адрес на домене установки,
 * переходы по нему видны в «Статистике → Переходы». Вставляется в текст или кнопкой.
 */
export function LinkPanel({
  postId,
  isAd,
  onInsertText,
  onInsertButton,
}: {
  postId: string;
  isAd: boolean;
  onInsertText: (url: string) => void;
  onInsertButton: (url: string) => void;
}) {
  const t = useTranslations('editor.link');
  const [items, setItems] = useState<LinkItem[]>([]);
  const [url, setUrl] = useState('https://');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: LinkItem[] }>('/links?days=30')
      .then((r) => !cancelled && setItems(r.items.filter((l) => l.postId === postId)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [postId]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      let host = url;
      try {
        host = new URL(url).hostname;
      } catch {
        // проверит сервер
      }
      const r = await api.post<{ id: string; shortUrl: string }>('/links', {
        title: host,
        targetUrl: url,
        isAd,
        postId,
      });
      setItems((xs) => [
        {
          id: r.id,
          title: host,
          targetUrl: url,
          shortUrl: r.shortUrl,
          postId,
          total: { clicks: 0, unique: 0 },
        },
        ...xs,
      ]);
      setUrl('https://');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="group rounded-[16px] border border-border bg-surface"
      open={isAd || items.length > 0}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-semibold [&::-webkit-details-marker]:hidden">
        {t('title')}
        <span className="flex items-center gap-1 text-sm font-medium text-text-faint">
          {items.length ? t('count', { n: items.length }) : t('none')}
          <Icon name="chevron" size={16} className="transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-xs text-text-faint">{t('hint')}</p>
        <div className="flex gap-2">
          <input
            className={`${inputCls} min-w-0 flex-1`}
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            type="button"
            className={`${btn.primary} shrink-0`}
            disabled={busy || url.length < 10}
            onClick={() => void create()}
          >
            {t('create')}
          </button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {items.map((l) => (
          <div key={l.id} className="flex flex-col gap-2 rounded-[12px] bg-surface-2 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-bold text-accent">
                {l.shortUrl.replace(/^https?:\/\//, '')}
              </span>
              <span className="shrink-0 text-xs text-text-faint">
                {t('clicks', { n: l.total.clicks })}
              </span>
            </div>
            <span className="truncate text-xs text-text-faint">→ {l.targetUrl}</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${btn.outline} min-h-9 text-sm`}
                onClick={() => onInsertText(l.shortUrl)}
              >
                {t('toText')}
              </button>
              <button
                type="button"
                className={`${btn.outline} min-h-9 text-sm`}
                onClick={() => onInsertButton(l.shortUrl)}
              >
                {t('toButton')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
