import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EMPTY_POST_CONTENT, summarizeContent, type PostContent } from '@author-studio/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DB, type Database } from '../database/database.module.js';
import { channels, posts, publications } from '../database/schema.js';
import { MediaService, toMediaView } from '../media/media.service.js';

export type PostRow = typeof posts.$inferSelect;

export interface PublicationView {
  id: string;
  postId: string;
  channelId: string;
  channelTitle: string;
  channelUsername: string | null;
  status: (typeof publications.$inferSelect)['status'];
  scheduledAt: string;
  publishedAt: string | null;
  messageIds: number[] | null;
  attempts: number;
  lastError: string | null;
}

export const ACTIVE_PUBLICATION_STATUSES = ['scheduled', 'sending', 'ambiguous'] as const;

@Injectable()
export class PostsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  async getOwned(ownerId: string, id: string): Promise<PostRow> {
    const [row] = await this.db
      .select()
      .from(posts)
      .where(and(eq(posts.id, id), eq(posts.ownerId, ownerId), isNull(posts.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Публикация не найдена');
    return row;
  }

  /** Медиа в содержимом должны принадлежать владельцу. */
  private async assertMediaOwned(ownerId: string, content: PostContent): Promise<void> {
    const ids = [...new Set(content.media.map((m) => m.assetId))];
    const found = await this.media.findMany(ownerId, ids);
    if (found.length !== ids.length) {
      throw new BadRequestException('Медиафайл не найден — загрузите его заново');
    }
  }

  async publicationsOf(ownerId: string, postIds: string[]): Promise<PublicationView[]> {
    if (postIds.length === 0) return [];
    const rows = await this.db
      .select({ p: publications, channelTitle: channels.title, channelUsername: channels.username })
      .from(publications)
      .innerJoin(channels, eq(channels.id, publications.channelId))
      .where(and(eq(publications.ownerId, ownerId), inArray(publications.postId, postIds)))
      .orderBy(publications.scheduledAt);
    return rows.map((r) => toPublicationView(r.p, r.channelTitle, r.channelUsername));
  }

  async view(ownerId: string, row: PostRow) {
    const mediaRows = await this.media.findMany(
      ownerId,
      row.content.media.map((m) => m.assetId),
    );
    return {
      id: row.id,
      content: row.content,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      media: mediaRows.map(toMediaView),
      publications: await this.publicationsOf(ownerId, [row.id]),
    };
  }

  async list(ownerId: string) {
    const rows = await this.db
      .select()
      .from(posts)
      .where(and(eq(posts.ownerId, ownerId), isNull(posts.deletedAt)))
      .orderBy(desc(posts.updatedAt))
      .limit(200);
    const pubs = await this.publicationsOf(
      ownerId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      id: r.id,
      summary: summarizeContent(r.content),
      mediaCount: r.content.media.length,
      version: r.version,
      updatedAt: r.updatedAt.toISOString(),
      publications: pubs.filter((p) => p.postId === r.id),
    }));
  }

  async create(ownerId: string, content: PostContent = EMPTY_POST_CONTENT) {
    await this.assertMediaOwned(ownerId, content);
    const [row] = await this.db.insert(posts).values({ ownerId, content }).returning();
    await this.audit.record({
      action: 'post.created',
      actorUserId: ownerId,
      entityType: 'post',
      entityId: row!.id,
    });
    return this.view(ownerId, row!);
  }

  /**
   * Сохранение с оптимистической блокировкой: версия клиента должна совпасть с текущей,
   * иначе 409 с актуальной версией — правки из другого окна не затираются молча.
   */
  async save(ownerId: string, id: string, content: PostContent, version: number) {
    await this.assertMediaOwned(ownerId, content);
    const [row] = await this.db
      .update(posts)
      .set({ content, version: sql`${posts.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(posts.id, id),
          eq(posts.ownerId, ownerId),
          isNull(posts.deletedAt),
          eq(posts.version, version),
        ),
      )
      .returning();
    if (row) return this.view(ownerId, row);
    const current = await this.getOwned(ownerId, id); // 404, если поста нет
    throw new ConflictException({
      message: 'Публикация изменена в другом окне или на другом устройстве',
      details: { current: await this.view(ownerId, current) },
    });
  }

  async duplicate(ownerId: string, id: string) {
    const src = await this.getOwned(ownerId, id);
    return this.create(ownerId, src.content);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.getOwned(ownerId, id);
    const [active] = await this.db
      .select({ id: publications.id })
      .from(publications)
      .where(
        and(
          eq(publications.postId, id),
          inArray(publications.status, [...ACTIVE_PUBLICATION_STATUSES]),
        ),
      )
      .limit(1);
    if (active) {
      throw new ConflictException('Сначала отмените запланированные отправки этой публикации');
    }
    await this.db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, id));
    await this.audit.record({
      action: 'post.deleted',
      actorUserId: ownerId,
      entityType: 'post',
      entityId: id,
    });
  }
}

export function toPublicationView(
  p: typeof publications.$inferSelect,
  channelTitle: string,
  channelUsername: string | null,
): PublicationView {
  return {
    id: p.id,
    postId: p.postId,
    channelId: p.channelId,
    channelTitle,
    channelUsername,
    status: p.status,
    scheduledAt: p.scheduledAt.toISOString(),
    publishedAt: p.publishedAt?.toISOString() ?? null,
    messageIds: p.messageIds,
    attempts: p.attempts,
    lastError: p.lastError,
  };
}
