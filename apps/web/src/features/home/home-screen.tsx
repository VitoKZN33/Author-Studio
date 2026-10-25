'use client';

import type { ReadinessReport } from '@author-studio/shared';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/shared/api';
import { Icon } from '@/shared/ui/icons';
import { btn, PageHeader, SectionTitle } from '@/shared/ui/kit';
import { useNewPost } from '@/shared/ui/new-post';
import type { Overview } from '../analytics/types';
import { ChannelChip } from '../channels/channel-chip';
import { useChannels } from '../channels/use-channels';
import { PostCard } from '../posts/post-card';
import type { PostListItem, PublicationView } from '../posts/types';
import { useSystemInfo } from '../system/use-system-info';

/**
 * Главная отвечает на вопрос «что с моим каналом»: подписчики, что выйдет дальше,
 * что требует внимания, последние посты. Технические подробности — в настройках;
 * здесь только предупреждение, если что-то сломалось.
 */
export function HomeScreen() {
  const t = useTranslations('home');
  const format = useFormatter();
  const tz = useSystemInfo()?.timezone;
  const newPost = useNewPost();
  const { channels, selected, select, channel } = useChannels();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [posts, setPosts] = useState<PostListItem[] | null>(null);
  const [upcoming, setUpcoming] = useState<PublicationView[]>([]);
  const [healthy, setHealthy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const qs = new URLSearchParams({ from, to, status: 'scheduled,failed,ambiguous' });
    api
      .get<{ items: PostListItem[] }>('/posts')
      .then((r) => !cancelled && setPosts(r.items))
      .catch(() => !cancelled && setPosts([]));
    api
      .get<{ items: PublicationView[] }>(`/publications?${qs}`)
      .then((r) => !cancelled && setUpcoming(r.items))
      .catch(() => undefined);
    fetch('/api/health/status', { cache: 'no-store' })
      .then((r) => r.json() as Promise<ReadinessReport>)
      .then((r) => !cancelled && setHealthy(r.status === 'ok'))
      .catch(() => !cancelled && setHealthy(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api
      .get<Overview>(`/analytics/channels/${selected}/overview?days=7`)
      .then((o) => !cancelled && setOverview(o))
      .catch(() => !cancelled && setOverview(null));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const problems = upcoming.filter((p) => p.status === 'failed' || p.status === 'ambiguous');
  const next = upcoming
    .filter((p) => p.status === 'scheduled' && (!selected || p.channelId === selected))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const channelIssue = channel && channel.status !== 'active';
  const recent = (posts ?? []).slice(0, 3);
  const fmtWhen = (iso: string) =>
    format.dateTime(new Date(iso), {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (channels && channels.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t('title')} />
        <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] bg-accent p-5 text-on-accent">
          <p className="text-lg font-extrabold">{t('start.title')}</p>
          <p className="text-sm opacity-90">{t('start.text')}</p>
          <Link
            href="/channels/"
            className="rounded-full bg-surface px-4 py-2.5 font-bold text-accent"
          >
            {t('start.action')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('title')}
        right={
          channels && <ChannelChip channels={channels} selected={selected} onSelect={select} />
        }
      />

      {(!healthy || problems.length > 0 || channelIssue) && (
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-card)] bg-warn-soft px-4 py-3 text-sm text-warn">
          {!healthy && (
            <Link href="/settings/" className="flex items-center gap-2 font-semibold">
              <Icon name="alert" size={18} />
              {t('alerts.system')}
            </Link>
          )}
          {problems.length > 0 && (
            <Link href="/posts/" className="flex items-center gap-2 font-semibold">
              <Icon name="alert" size={18} />
              {t('alerts.publications', { n: problems.length })}
            </Link>
          )}
          {channelIssue && (
            <Link href="/channels/" className="flex items-center gap-2 font-semibold">
              <Icon name="alert" size={18} />
              {t('alerts.channel', { title: channel.title })}
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <Stat
          value={overview?.current ? format.number(overview.current.value) : '—'}
          label={t('stats.subscribers')}
        />
        <Stat
          value={
            overview?.periodChange
              ? `${overview.periodChange.delta > 0 ? '+' : ''}${overview.periodChange.delta}`
              : '—'
          }
          label={t('stats.week')}
          tone={overview?.periodChange && overview.periodChange.delta > 0 ? 'up' : undefined}
        />
        <Stat value={String(next.length)} label={t('stats.scheduled')} />
      </div>

      {next[0] ? (
        <Link
          href={`/posts/view/?id=${next[0].postId}`}
          className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-accent px-4 py-4 text-on-accent"
        >
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold opacity-85">
              {t('next.label', { when: fmtWhen(next[0].scheduledAt) })}
            </span>
            <span className="block truncate text-base font-bold">{next[0].summary}</span>
          </span>
          <Icon name="chevron" className="shrink-0" />
        </Link>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-accent px-4 py-4 text-on-accent">
          <span className="min-w-0">
            <span className="block text-base font-bold">{t('next.noneTitle')}</span>
            <span className="block text-[13px] opacity-85">{t('next.noneText')}</span>
          </span>
          <button
            type="button"
            onClick={() => void newPost.create()}
            disabled={newPost.busy}
            className="shrink-0 rounded-full bg-surface px-4 py-2.5 text-sm font-bold text-accent"
          >
            {t('next.create')}
          </button>
        </div>
      )}

      <SectionTitle
        right={
          <Link href="/posts/" className={`${btn.link} text-sm`}>
            {t('allPosts')}
          </Link>
        }
      >
        {t('recent')}
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {recent.map((p) => (
          <PostCard key={p.id} item={p} />
        ))}
        <Link
          href="/ai/?tab=plan"
          className="flex flex-col overflow-hidden rounded-[16px] border border-border bg-surface"
        >
          <div className="grid aspect-[4/3] w-full place-items-center bg-surface-2 text-accent">
            <Icon name="spark" size={28} />
          </div>
          <div className="px-2.5 pt-2 pb-2.5">
            <p className="text-[13.5px] font-semibold">{t('aiPlan.title')}</p>
            <p className="text-[12px] text-text-faint">{t('aiPlan.text')}</p>
          </div>
        </Link>
      </div>
    </div>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'up' }) {
  return (
    <div className="border-r border-border px-3.5 py-3 last:border-0">
      <b
        className={`block text-[22px] leading-tight font-extrabold tracking-tight tabular-nums ${tone === 'up' ? 'text-ok' : ''}`}
      >
        {value}
      </b>
      <span className="text-[12px] leading-tight text-text-faint">{label}</span>
    </div>
  );
}
