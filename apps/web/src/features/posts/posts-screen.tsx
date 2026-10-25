'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { Icon } from '@/shared/ui/icons';
import { btn, Empty, PageHeader, Segmented } from '@/shared/ui/kit';
import { useNewPost } from '@/shared/ui/new-post';
import { PostCard } from './post-card';
import { groupOf, headlinePublication, type PostListItem } from './types';

type Tab = 'drafts' | 'scheduled' | 'published';
const TABS: Tab[] = ['drafts', 'scheduled', 'published'];

export function PostsScreen() {
  const t = useTranslations('posts');
  const router = useRouter();
  const params = useSearchParams();
  const newPost = useNewPost();
  const [items, setItems] = useState<PostListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const groups = useMemo(() => {
    const g = { attention: [], drafts: [], scheduled: [], published: [] } as Record<
      'attention' | Tab,
      PostListItem[]
    >;
    for (const i of items ?? []) g[groupOf(i)].push(i);
    const at = (i: PostListItem) => {
      const p = headlinePublication(i);
      return p ? (p.publishedAt ?? p.scheduledAt) : i.updatedAt;
    };
    g.scheduled.sort((a, b) => at(a).localeCompare(at(b)));
    g.published.sort((a, b) => at(b).localeCompare(at(a)));
    return g;
  }, [items]);

  const requested = params.get('tab') as Tab | null;
  const fallback: Tab = groups.scheduled.length
    ? 'scheduled'
    : groups.drafts.length
      ? 'drafts'
      : 'published';
  const tab: Tab = requested && TABS.includes(requested) ? requested : fallback;
  const multiChannel =
    new Set((items ?? []).flatMap((i) => i.publications.map((p) => p.channelId))).size > 1;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('title')}
        right={
          <Link href="/calendar/" className={`${btn.outline} min-h-10 rounded-full text-sm`}>
            <Icon name="calendar" size={18} />
            {t('calendar')}
          </Link>
        }
      />
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

      {items && items.length === 0 && (
        <Empty
          title={t('emptyTitle')}
          text={t('empty')}
          action={
            <button type="button" className={btn.ink} onClick={() => void newPost.create()}>
              <Icon name="plus" size={18} strokeWidth={2.2} />
              {t('new')}
            </button>
          }
        />
      )}

      {groups.attention.length > 0 && (
        <section className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-warn-soft p-3">
          <h2 className="flex items-center gap-2 px-1 text-sm font-bold text-warn">
            <Icon name="alert" size={18} />
            {t('groups.attention')}
          </h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {groups.attention.map((i) => (
              <PostCard key={i.id} item={i} showChannel={multiChannel} />
            ))}
          </div>
        </section>
      )}

      {items && items.length > 0 && (
        <>
          <Segmented
            label={t('title')}
            value={tab}
            onChange={(v) => router.replace(`/posts/?tab=${v}`)}
            options={TABS.map((k) => ({
              value: k,
              label: `${t(`groups.${k}`)} ${groups[k].length}`,
            }))}
          />
          {groups[tab].length === 0 ? (
            <p className="px-1 text-sm text-text-muted">{t(`none.${tab}`)}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {groups[tab].map((i) => (
                <PostCard key={i.id} item={i} showChannel={multiChannel} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
