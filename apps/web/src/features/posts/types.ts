import type { PostContent } from '@author-studio/shared';

export type PublicationStatus =
  'scheduled' | 'sending' | 'published' | 'failed' | 'ambiguous' | 'cancelled';

export interface PublicationView {
  id: string;
  postId: string;
  channelId: string;
  channelTitle: string;
  channelUsername: string | null;
  status: PublicationStatus;
  scheduledAt: string;
  publishedAt: string | null;
  messageIds: number[] | null;
  attempts: number;
  lastError: string | null;
  summary?: string;
}

export interface MediaView {
  id: string;
  kind: 'photo' | 'video';
  mime: string;
  size: number;
  originalName: string | null;
}

export interface PostView {
  id: string;
  content: PostContent;
  version: number;
  createdAt: string;
  updatedAt: string;
  media: MediaView[];
  publications: PublicationView[];
}

export interface PostListItem {
  id: string;
  summary: string;
  /** Начало текста — для постов без картинки. */
  excerpt: string;
  cover: { id: string; kind: 'photo' | 'video' } | null;
  mediaCount: number;
  version: number;
  updatedAt: string;
  publications: PublicationView[];
}

export const STATUS_TONE: Record<PublicationStatus, string> = {
  scheduled: 'bg-accent-soft text-accent',
  sending: 'bg-accent-soft text-accent',
  published: 'bg-ok-soft text-ok',
  failed: 'bg-danger-soft text-danger',
  ambiguous: 'bg-warn-soft text-warn',
  cancelled: 'bg-surface-2 text-text-faint',
};

/** Точка статуса в мобильном календаре (классы перечислены явно — для Tailwind). */
export const STATUS_DOT: Record<PublicationStatus, string> = {
  scheduled: 'bg-accent',
  sending: 'bg-accent',
  published: 'bg-ok',
  failed: 'bg-danger',
  ambiguous: 'bg-warn',
  cancelled: 'bg-text-faint',
};

export type PostGroup = 'attention' | 'scheduled' | 'drafts' | 'published';

/** В какую группу списка попадает публикация. */
export function groupOf(item: Pick<PostListItem, 'publications'>): PostGroup {
  const statuses = item.publications.map((p) => p.status);
  if (statuses.some((s) => s === 'failed' || s === 'ambiguous')) return 'attention';
  if (statuses.some((s) => s === 'scheduled' || s === 'sending')) return 'scheduled';
  if (statuses.some((s) => s === 'published')) return 'published';
  return 'drafts';
}

/** Ссылка на пост в публичном канале. */
export function postLink(
  p: Pick<PublicationView, 'channelUsername' | 'messageIds'>,
): string | null {
  const id = p.messageIds?.[0];
  return p.channelUsername && id ? `https://t.me/${p.channelUsername}/${id}` : null;
}

/** Ближайшая или последняя отправка поста — для подписи на карточке. */
export function headlinePublication(
  item: Pick<PostListItem, 'publications'>,
): PublicationView | null {
  const live = item.publications.filter((p) => p.status !== 'cancelled');
  const problem = live.find((p) => p.status === 'failed' || p.status === 'ambiguous');
  if (problem) return problem;
  const scheduled = live
    .filter((p) => p.status === 'scheduled' || p.status === 'sending')
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  if (scheduled) return scheduled;
  return (
    live
      .filter((p) => p.status === 'published')
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))[0] ?? null
  );
}
