import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { summarizeContent, validatePostContent } from '@author-studio/shared';
import type { Queue } from 'bullmq';
import { and, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DB, type Database } from '../database/database.module.js';
import { channels, posts, publications } from '../database/schema.js';
import { MediaService } from '../media/media.service.js';
import { PostsService, toPublicationView, type PublicationView } from '../posts/posts.service.js';
import { PUBLICATIONS_QUEUE } from '../queue/queue.module.js';
import { enqueuePublish } from './publication-jobs.js';

const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 3600_000;
/** Допуск на расхождение часов клиента: время «в прошлом» до минуты считается «сейчас». */
const PAST_TOLERANCE_MS = 60_000;

type PublicationRow = typeof publications.$inferSelect;
type Status = PublicationRow['status'];

@Injectable()
export class PublishingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PUBLICATIONS_QUEUE) private readonly queue: Queue,
    private readonly posts: PostsService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  private resolveTime(scheduledAt: string | null | undefined): Date {
    const now = Date.now();
    if (!scheduledAt) return new Date(now);
    const t = new Date(scheduledAt);
    if (Number.isNaN(t.getTime())) throw new BadRequestException('Неверное время публикации');
    if (t.getTime() < now - PAST_TOLERANCE_MS) {
      throw new BadRequestException('Время публикации уже прошло. Выберите время в будущем');
    }
    if (t.getTime() > now + MAX_SCHEDULE_AHEAD_MS) {
      throw new BadRequestException('Запланировать можно не дальше чем на год вперёд');
    }
    return t.getTime() < now ? new Date(now) : t;
  }

  /**
   * Публикация в один или несколько каналов сразу или по расписанию. Версия черновика
   * должна совпадать: публикуется именно то, что видит владелец.
   */
  async publish(
    ownerId: string,
    postId: string,
    input: { channelIds: string[]; scheduledAt?: string | null; version: number },
  ): Promise<PublicationView[]> {
    const post = await this.posts.getOwned(ownerId, postId);
    if (post.version !== input.version) {
      throw new ConflictException('Черновик изменён — сохраните его и повторите публикацию');
    }
    const mediaRows = await this.media.findMany(
      ownerId,
      post.content.media.map((m) => m.assetId),
    );
    const problems = validatePostContent(post.content, MediaService.infoMap(mediaRows));
    if (problems.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Публикацию нельзя отправить: ' + problems.map((p) => p.message).join('; '),
        details: problems,
      });
    }

    const channelIds = [...new Set(input.channelIds)];
    const chs = await this.db
      .select()
      .from(channels)
      .where(and(eq(channels.ownerId, ownerId), inArray(channels.id, channelIds)));
    if (chs.length !== channelIds.length) throw new NotFoundException('Канал не найден');
    const unavailable = chs.filter((c) => c.status !== 'active');
    if (unavailable.length > 0) {
      throw new BadRequestException(
        `Каналы недоступны для публикации: ${unavailable.map((c) => `«${c.title}»`).join(', ')}. Проверьте права бота`,
      );
    }

    const scheduledAt = this.resolveTime(input.scheduledAt);
    let rows: PublicationRow[];
    try {
      rows = await this.db
        .insert(publications)
        .values(
          chs.map((c) => ({
            ownerId,
            postId,
            channelId: c.id,
            status: 'scheduled' as const,
            scheduledAt,
          })),
        )
        .returning();
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          'Эта публикация уже запланирована или отправляется в один из выбранных каналов',
        );
      }
      throw e;
    }
    // Постановка в очередь — после фиксации строк. Если Redis недоступен, задания
    // восстановит реконсилятор по данным БД.
    await Promise.all(
      rows.map((r) => enqueuePublish(this.queue, r.id, r.scheduledAt).catch(() => undefined)),
    );
    await this.audit.record({
      action: 'publication.scheduled',
      actorUserId: ownerId,
      entityType: 'post',
      entityId: postId,
      metadata: { channels: chs.length, scheduledAt: scheduledAt.toISOString() },
    });
    const byId = new Map(chs.map((c) => [c.id, c]));
    return rows.map((r) =>
      toPublicationView(r, byId.get(r.channelId)!.title, byId.get(r.channelId)!.username),
    );
  }

  private async getOwned(ownerId: string, id: string): Promise<PublicationRow> {
    const [row] = await this.db
      .select()
      .from(publications)
      .where(and(eq(publications.id, id), eq(publications.ownerId, ownerId)))
      .limit(1);
    if (!row) throw new NotFoundException('Отправка не найдена');
    return row;
  }

  /** Атомарная смена статуса: только из ожидаемого состояния (защита от гонок с worker). */
  private async transition(
    ownerId: string,
    id: string,
    from: Status[],
    set: Partial<typeof publications.$inferInsert>,
    conflictMessage: string,
  ): Promise<PublicationRow> {
    const [row] = await this.db
      .update(publications)
      .set({ ...set, updatedAt: new Date() })
      .where(
        and(
          eq(publications.id, id),
          eq(publications.ownerId, ownerId),
          inArray(publications.status, from),
        ),
      )
      .returning();
    if (row) return row;
    await this.getOwned(ownerId, id); // 404, если отправки нет
    throw new ConflictException(conflictMessage);
  }

  async view(row: PublicationRow): Promise<PublicationView> {
    const [c] = await this.db
      .select()
      .from(channels)
      .where(eq(channels.id, row.channelId))
      .limit(1);
    return toPublicationView(row, c?.title ?? '—', c?.username ?? null);
  }

  async reschedule(ownerId: string, id: string, scheduledAt: string): Promise<PublicationView> {
    const at = this.resolveTime(scheduledAt);
    const row = await this.transition(
      ownerId,
      id,
      ['scheduled'],
      { scheduledAt: at },
      'Перенести можно только запланированную отправку — эта уже отправляется или завершена',
    );
    await enqueuePublish(this.queue, row.id, row.scheduledAt).catch(() => undefined);
    await this.audit.record({
      action: 'publication.rescheduled',
      actorUserId: ownerId,
      entityType: 'publication',
      entityId: id,
      metadata: { scheduledAt: at.toISOString() },
    });
    return this.view(row);
  }

  async cancel(ownerId: string, id: string): Promise<PublicationView> {
    const row = await this.transition(
      ownerId,
      id,
      ['scheduled'],
      { status: 'cancelled' },
      'Отменить можно только запланированную отправку — эта уже отправляется или завершена',
    );
    await this.audit.record({
      action: 'publication.cancelled',
      actorUserId: ownerId,
      entityType: 'publication',
      entityId: id,
    });
    return this.view(row);
  }

  /** Повтор после ошибки: новая отправка «сейчас». */
  async retry(ownerId: string, id: string): Promise<PublicationView> {
    const row = await this.transition(
      ownerId,
      id,
      ['failed'],
      { status: 'scheduled', scheduledAt: new Date(), lastError: null },
      'Повторить можно только отправку, завершившуюся ошибкой',
    );
    await enqueuePublish(this.queue, row.id, row.scheduledAt).catch(() => undefined);
    await this.audit.record({
      action: 'publication.retried',
      actorUserId: ownerId,
      entityType: 'publication',
      entityId: id,
    });
    return this.view(row);
  }

  /**
   * Неизвестный результат: владелец проверил канал и сообщает, появился ли пост.
   * published — отметить опубликованным; resend — отправить заново.
   */
  async resolve(
    ownerId: string,
    id: string,
    outcome: 'published' | 'resend',
  ): Promise<PublicationView> {
    const conflict = 'Отметить результат можно только для отправки с неизвестным результатом';
    const row =
      outcome === 'published'
        ? await this.transition(
            ownerId,
            id,
            ['ambiguous'],
            {
              status: 'published',
              publishedAt: new Date(),
              lastError: 'Публикация подтверждена владельцем вручную',
            },
            conflict,
          )
        : await this.transition(
            ownerId,
            id,
            ['ambiguous'],
            { status: 'scheduled', scheduledAt: new Date(), lastError: null },
            conflict,
          );
    if (outcome === 'resend')
      await enqueuePublish(this.queue, row.id, row.scheduledAt).catch(() => undefined);
    await this.audit.record({
      action: 'publication.resolved',
      actorUserId: ownerId,
      entityType: 'publication',
      entityId: id,
      metadata: { outcome },
    });
    return this.view(row);
  }

  /** Отправки за период (для календаря) с кратким содержанием поста. */
  async list(ownerId: string, q: { from: Date; to: Date; channelId?: string; status?: Status[] }) {
    const where: SQL[] = [
      eq(publications.ownerId, ownerId),
      gte(publications.scheduledAt, q.from),
      lt(publications.scheduledAt, q.to),
    ];
    if (q.channelId) where.push(eq(publications.channelId, q.channelId));
    if (q.status?.length) where.push(inArray(publications.status, q.status));
    const rows = await this.db
      .select({
        p: publications,
        title: channels.title,
        username: channels.username,
        content: posts.content,
      })
      .from(publications)
      .innerJoin(channels, eq(channels.id, publications.channelId))
      .innerJoin(posts, eq(posts.id, publications.postId))
      .where(and(...where))
      .orderBy(publications.scheduledAt)
      .limit(1000);
    return rows.map((r) => ({
      ...toPublicationView(r.p, r.title, r.username),
      summary: summarizeContent(r.p.sentContent ?? r.content),
    }));
  }
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code === '23505' || err.cause?.code === '23505';
}
