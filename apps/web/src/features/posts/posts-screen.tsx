'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { useSystemInfo } from '../system/use-system-info';
import { groupOf, STATUS_TONE, type PostGroup, type PostListItem, type PostView } from './types';

const ORDER: PostGroup[] = ['attention', 'scheduled', 'drafts', 'published'];

export function PostsScreen() {
  const t = useTranslations('posts');
  const router = useRouter();
  const [items, setItems] = useState<PostListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: PostListItem[] }>('/posts')
      .then((r) => !cancelled && setItems(r.items))
      .catch(
        (e: unknown) => !cancelled && setError(e instanceof ApiError ? e.message : t('loadFailed')),
      );
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function create() {
    setCreating(true);
    try {
      const post = await api.post<PostView>('/posts', {});
      router.push(`/posts/edit/?id=${post.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('createFailed'));
      setCreating(false);
    }
  }

  const groups = items
    ? ORDER.map((g) => ({ g, list: items.filter((i) => groupOf(i) === g) })).filter(
        (x) => x.list.length > 0,
      )
    : [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <button
          type="button"
          onClick={() => void create()}
          disabled={creating}
          className="min-h-10 rounded-[var(--radius-control)] bg-accent px-4 text-sm font-medium text-bg disabled:opacity-50"
        >
          {creating ? t('creating') : t('new')}
        </button>
      </header>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {!items && !error && (
        <p className="text-sm text-text-muted" aria-busy="true">
          {t('loading')}
        </p>
      )}
      {items?.length === 0 && (
        <p className="max-w-prose text-sm leading-relaxed text-text-muted">{t('empty')}</p>
      )}
      {groups.map(({ g, list }) => (
        <section key={g} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-muted">
            {t(`groups.${g}`)} <span className="text-text-faint">{list.length}</span>
          </h2>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            {list.map((item) => (
              <PostRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PostRow({ item }: { item: PostListItem }) {
  const t = useTranslations('posts');
  const tp = useTranslations('publications');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const tz = useSystemInfo()?.timezone;
  const visible = item.publications.filter((p) => p.status !== 'cancelled');
  return (
    <li>
      <Link
        href={`/posts/edit/?id=${item.id}`}
        className="flex flex-col gap-1.5 px-4 py-3 hover:bg-surface-2"
      >
        <span className="truncate text-[15px]">{item.summary}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-text-faint">
          {item.mediaCount > 0 && <span>{t('media', { count: item.mediaCount })}</span>}
          {visible.length === 0 && (
            <span>{t('edited', { when: format.relativeTime(new Date(item.updatedAt), now) })}</span>
          )}
          {visible.map((p) => (
            <span key={p.id} className={`rounded-full px-2 py-0.5 ${STATUS_TONE[p.status]}`}>
              {p.channelTitle}:{' '}
              {p.status === 'scheduled'
                ? format.dateTime(new Date(p.scheduledAt), {
                    timeZone: tz,
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : tp(`status.${p.status}`)}
            </span>
          ))}
        </span>
      </Link>
    </li>
  );
}
