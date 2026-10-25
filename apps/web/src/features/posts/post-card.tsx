'use client';

import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Pill, type PillTone } from '@/shared/ui/kit';
import { Thumb } from '@/shared/ui/thumb';
import { useSystemInfo } from '../system/use-system-info';
import { headlinePublication, postHref, type PostListItem, type PublicationStatus } from './types';

const TONE: Record<PublicationStatus, PillTone> = {
  scheduled: 'accent',
  sending: 'accent',
  published: 'ok',
  failed: 'danger',
  ambiguous: 'warn',
  cancelled: 'faint',
};

/** Карточка поста в сетке: обложка, статус, начало текста, время. */
export function PostCard({
  item,
  showChannel = false,
}: {
  item: PostListItem;
  showChannel?: boolean;
}) {
  const t = useTranslations('posts');
  const tp = useTranslations('publications');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const tz = useSystemInfo()?.timezone;
  const pub = headlinePublication(item);
  const when = (iso: string) => {
    const d = new Date(iso);
    const sameDay =
      format.dateTime(d, { timeZone: tz, dateStyle: 'short' }) ===
      format.dateTime(now, { timeZone: tz, dateStyle: 'short' });
    return sameDay
      ? t('today', {
          time: format.dateTime(d, { timeZone: tz, hour: '2-digit', minute: '2-digit' }),
        })
      : format.dateTime(d, {
          timeZone: tz,
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
  };
  const meta = pub
    ? when(pub.status === 'published' ? (pub.publishedAt ?? pub.scheduledAt) : pub.scheduledAt)
    : t('edited', { when: format.relativeTime(new Date(item.updatedAt), now) });

  return (
    <Link
      href={postHref(item)}
      className="flex flex-col overflow-hidden rounded-[16px] border border-border bg-surface active:scale-[0.99]"
    >
      <div className="relative">
        {item.cover ? (
          <Thumb cover={item.cover} className="aspect-[4/3] w-full" />
        ) : (
          <div className="aspect-[4/3] w-full overflow-hidden bg-accent-soft px-3 pt-9 text-[13px] leading-snug text-text-muted">
            <p className="line-clamp-5 whitespace-pre-line">{item.excerpt || t('noText')}</p>
          </div>
        )}
        <span className="absolute top-2 left-2">
          <Pill tone={pub ? TONE[pub.status] : 'neutral'} solid={!!item.cover}>
            {pub ? tp(`status.${pub.status}`) : t('draft')}
          </Pill>
        </span>
        {item.mediaCount > 1 && (
          <span className="absolute top-2 right-2 rounded-full bg-black/55 px-1.5 text-[11px] font-bold text-white">
            {item.mediaCount}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 px-2.5 pt-2 pb-2.5">
        <p className="line-clamp-2 text-[13.5px] leading-snug font-semibold">
          {item.summary || t('noText')}
        </p>
        <p className="mt-auto truncate text-[12px] text-text-faint">
          {item.kind === 'ad' && <span className="mr-1 font-bold text-warn">{t('adTag')}</span>}
          {meta}
          {showChannel && pub ? `, ${pub.channelTitle}` : ''}
        </p>
      </div>
    </Link>
  );
}
