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
