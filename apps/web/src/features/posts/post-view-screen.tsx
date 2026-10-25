'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { Icon } from '@/shared/ui/icons';
import { btn, Pill } from '@/shared/ui/kit';
import type { PostStats } from '../analytics/types';
import { KindTag } from '../analytics/value-kind';
import { PublicationsList } from '../editor/publications-list';
import { PostPreview } from '../editor/preview';
import { useSystemInfo } from '../system/use-system-info';
import { postLink, type PostView, type PublicationView } from './types';

/**
 * Просмотр поста, который уже отправлен или запланирован: как он выглядит в канале,
 * статус по каждому каналу, отклик. Изменить можно только ещё не вышедший пост.
 */
export function PostViewScreen() {
  const t = useTranslations('postView');
  const format = useFormatter();
  const router = useRouter();
  const id = useSearchParams().get('id');
  const tz = useSystemInfo()?.timezone ?? 'Europe/Moscow';
  const [post, setPost] = useState<PostView | null>(null);
  const [pubs, setPubs] = useState<PublicationView[]>([]);
  const [stats, setStats] = useState<Map<string, PostStats>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .get<PostView>(`/posts/${id}`)
      .then((p) => {
        if (cancelled) return;
        setPost(p);
        setPubs(p.publications);
      })
      .catch(
        (e: unknown) => !cancelled && setError(e instanceof ApiError ? e.message : t('loadFailed')),
      );
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  // Отклик по опубликованным отправкам — из статистики канала.
  useEffect(() => {
    const published = pubs.filter((p) => p.status === 'published');
    if (published.length === 0) return;
    let cancelled = false;
    const channelIds = [...new Set(published.map((p) => p.channelId))];
    void Promise.all(
      channelIds.map((c) =>
        api
          .get<{ items: PostStats[] }>(`/analytics/channels/${c}/posts?days=90&sort=date`)
          .then((r) => r.items)
          .catch(() => [] as PostStats[]),
      ),
    ).then((lists) => {
      if (cancelled) return;
      const m = new Map<string, PostStats>();
      for (const s of lists.flat()) if (s.publicationId) m.set(s.publicationId, s);
      setStats(m);
    });
    return () => {
      cancelled = true;
    };
  }, [pubs]);

  if (!id) return <p className="text-sm text-text-muted">{t('noId')}</p>;
  if (error)
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  if (!post)
    return (
      <p className="text-sm text-text-muted" aria-busy="true">
        {t('loading')}
      </p>
    );

  const live = pubs.filter((p) => p.status !== 'cancelled');
  const editable =
    live.length === 0 || live.some((p) => p.status === 'scheduled' || p.status === 'failed');
  const published = live.filter((p) => p.status === 'published');
  const fmt = (iso: string) =>
    format.dateTime(new Date(iso), {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  async function duplicate() {
    const copy = await api.post<{ id: string }>(`/posts/${post!.id}/duplicate`);
    router.push(`/posts/edit/?id=${copy.id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/posts/"
          className="-ml-1 flex items-center gap-0.5 text-sm font-semibold text-accent"
        >
          <Icon name="back" size={18} />
          {t('back')}
        </Link>
        {editable && (
          <Link
            href={`/posts/edit/?id=${post.id}`}
            className={`${btn.primary} min-h-10 rounded-full text-sm`}
          >
            <Icon name="edit" size={16} />
            {t('edit')}
          </Link>
        )}
      </header>

      <ul className="flex flex-col gap-1.5">
        {live.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Pill
              tone={
                p.status === 'published'
                  ? 'ok'
                  : p.status === 'scheduled' || p.status === 'sending'
                    ? 'accent'
                    : p.status === 'failed'
                      ? 'danger'
                      : 'warn'
              }
            >
              {t(`status.${p.status}`)}
            </Pill>
            <span className="font-semibold">{fmt(p.publishedAt ?? p.scheduledAt)}</span>
            <span className="text-text-faint">{p.channelTitle}</span>
          </li>
        ))}
      </ul>

      <PostPreview
        content={post.content}
        media={post.media}
        channelTitle={live[0]?.channelTitle ?? ''}
      />

      {published.map((p) => {
        const s = stats.get(p.id);
        const link = postLink(p);
        return (
          <section
            key={p.id}
            className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-bold">
                {t('response', { channel: p.channelTitle })}
              </h2>
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm font-semibold text-accent"
                >
                  {t('openInTelegram')}
                  <Icon name="external" size={15} />
                </a>
              )}
            </div>
            <dl className="grid grid-cols-3 gap-2">
              <Metric
                label={t('reactions')}
                value={s?.reactions?.value ?? null}
                kind={s?.reactions ? 'fact' : 'none'}
              />
              <Metric
                label={t('views')}
                value={s?.views?.value ?? null}
                kind={s?.views ? 'manual' : 'none'}
              />
              <Metric
                label="ERR"
                value={s?.err ?? null}
                suffix="%"
                kind={s?.err != null ? 'estimate' : 'none'}
              />
            </dl>
            {!s?.views && <p className="text-xs text-text-faint">{t('viewsHint')}</p>}
          </section>
        );
      })}

      <PublicationsList
        items={pubs}
        timezone={tz}
        onChange={(p) => setPubs((ps) => ps.map((x) => (x.id === p.id ? p : x)))}
      />

      <button
        type="button"
        onClick={() => void duplicate()}
        className={`${btn.outline} self-start text-sm`}
      >
        <Icon name="copy" size={16} />
        {t('duplicate')}
      </button>
    </div>
  );
}

function Metric({
  label,
  value,
  kind,
  suffix = '',
}: {
  label: string;
  value: number | null;
  kind: 'fact' | 'manual' | 'estimate' | 'none';
  suffix?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-[14px] bg-surface-2 p-2.5">
      <dt className="text-[12px] text-text-faint">{label}</dt>
      <dd className="text-[20px] leading-tight font-extrabold tabular-nums">
        {value === null ? '—' : `${String(value).replace('.', ',')}${suffix}`}
      </dd>
      <KindTag kind={kind} />
    </div>
  );
}
