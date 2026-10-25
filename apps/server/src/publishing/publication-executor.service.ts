import { Inject, Injectable, Logger } from '@nestjs/common';
import { summarizeContent, validatePostContent, type PostContent } from '@author-studio/shared';
import type { Queue } from 'bullmq';
import { and, eq, lt, sql } from 'drizzle-orm';
import { access } from 'node:fs/promises';
import { AnalyticsIngestService } from '../analytics/ingest.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DB, type Database } from '../database/database.module.js';
import { channels, posts, publicationAttempts, publications } from '../database/schema.js';
import { MediaService, type MediaRow } from '../media/media.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PUBLICATIONS_QUEUE } from '../queue/queue.module.js';
import { TelegramApiError } from '../telegram/telegram-client.js';
import { enqueuePublish } from './publication-jobs.js';
import { TelegramPublisher } from './telegram-publisher.js';

/** Паузы безопасных повторов, когда запрос точно не дошёл до Telegram. */
export const SAFE_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];
/** Задание может сработать чуть раньше времени из-за точности таймеров. */
const DUE_TOLERANCE_MS = 1_000;
/** Отправка «зависла»: процесс упал между началом и записью результата. */
export const STUCK_SENDING_MS = 5 * 60_000;
/** Просроченные запланированные отправки без задания в очереди. */
const OVERDUE_MS = 60_000;

export type ExecuteOutcome =
  'published' | 'skipped' | 'rate_limited' | 'retry_scheduled' | 'failed' | 'ambiguous';

interface Claimed {
  id: string;
  postId: string;
  ownerId: string | null;
  attempts: number;
  scheduledAt: Date;
  content: PostContent;
  channel: typeof channels.$inferSelect;
  attemptId: bigint;
}

function describeTelegramError(e: TelegramApiError): string {
  const d = e.description.toLowerCase();
  if (d.includes('not enough rights') || d.includes('need administrator rights')) {
    return 'У бота нет прав на публикацию в канале';
  }
  if (d.includes('chat not found') || d.includes('bot was kicked') || d.includes('not a member')) {
    return 'Бот удалён из канала или канал недоступен';
  }
  if (d.includes('message is too long') || d.includes('caption is too long'))
    return 'Текст слишком длинный';
  if (
    d.includes('wrong file') ||
    d.includes('failed to get http url') ||
    d.includes('image_process_failed')
  ) {
    return 'Telegram не принял медиафайл (формат или размеры)';
  }
  if (d.includes("can't parse entities") || d.includes('entity'))
    return 'Telegram не принял форматирование текста';
  if (d.includes('button_url_invalid') || d.includes('url'))
    return 'Telegram не принял ссылку в кнопке или тексте';
  if (e.kind === 'unauthorized') return 'Telegram отклонил токен бота';
  return `Telegram отклонил публикацию: ${e.description}`;
}

/**
 * Исполнение отправок (worker). Гарантии:
 * — одну отправку выполняет только один процесс (SELECT … FOR UPDATE SKIP LOCKED + смена статуса);
 * — повтор выполняется только если запрос точно не дошёл до Telegram (429, отказ соединения);
 * — при обрыве связи после отправки запроса — статус ambiguous и решение владельца.
 */
@Injectable()
export class PublicationExecutor {
  private readonly logger = new Logger(PublicationExecutor.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PUBLICATIONS_QUEUE) private readonly queue: Queue,
    private readonly publisher: TelegramPublisher,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsIngestService,
  ) {}

  private async claim(publicationId: string): Promise<Claimed | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ p: publications, content: posts.content, channel: channels })
        .from(publications)
        .innerJoin(posts, eq(posts.id, publications.postId))
        .innerJoin(channels, eq(channels.id, publications.channelId))
        .where(eq(publications.id, publicationId))
        .for('update', { of: publications, skipLocked: true })
        .limit(1);
      if (!row || row.p.status !== 'scheduled') return null;
      if (row.p.scheduledAt.getTime() > Date.now() + DUE_TOLERANCE_MS) return null; // перенесено на позже
      await tx
        .update(publications)
        .set({
          status: 'sending',
          attempts: sql`${publications.attempts} + 1`,
          sentContent: row.content,
          updatedAt: new Date(),
        })
        .where(eq(publications.id, publicationId));
      const [attempt] = await tx
        .insert(publicationAttempts)
        .values({ publicationId })
        .returning({ id: publicationAttempts.id });
      return {
        id: row.p.id,
        postId: row.p.postId,
        ownerId: row.p.ownerId,
        attempts: row.p.attempts + 1,
        scheduledAt: row.p.scheduledAt,
        content: row.content,
        channel: row.channel,
        attemptId: attempt!.id,
      };
    });
  }

  private async finishAttempt(
    attemptId: bigint,
    result: (typeof publicationAttempts.$inferInsert)['result'],
    error?: { code?: number; description?: string },
  ) {
    await this.db
      .update(publicationAttempts)
      .set({
        finishedAt: new Date(),
        result,
        errorCode: error?.code ?? null,
        description: error?.description ?? null,
      })
      .where(eq(publicationAttempts.id, attemptId));
  }

  private channelName(c: Claimed['channel']): string {
    return c.username ? `«${c.title}» (@${c.username})` : `«${c.title}»`;
  }

  private async fail(c: Claimed, message: string, code?: number): Promise<ExecuteOutcome> {
    await this.db
      .update(publications)
      .set({ status: 'failed', lastError: message, updatedAt: new Date() })
      .where(eq(publications.id, c.id));
    await this.finishAttempt(c.attemptId, 'permanent', { code, description: message });
    await this.audit.record({
      action: 'publication.failed',
      entityType: 'publication',
      entityId: c.id,
      metadata: { reason: message },
    });
    await this.notifications.notifyOwner({
      category: 'publishProblems',
      text: `❌ Не удалось опубликовать в ${this.channelName(c.channel)}: ${message}.\n«${summarizeContent(c.content, 60)}»`,
      openPath: `/posts/edit/?id=${c.postId}`,
      dedupeKey: `failed-${c.id}-${c.attempts}`,
    });
    return 'failed';
  }

  private async backToScheduled(c: Claimed, delayMs: number, suffix: string): Promise<void> {
    await this.db
      .update(publications)
      .set({ status: 'scheduled', updatedAt: new Date() })
      .where(eq(publications.id, c.id));
    await enqueuePublish(this.queue, c.id, c.scheduledAt, { delayMs, suffix });
  }

  async execute(publicationId: string): Promise<ExecuteOutcome> {
    const c = await this.claim(publicationId);
    if (!c) return 'skipped';

    // Подготовка: ошибки здесь возникают до обращения к Telegram — результат однозначен.
    let mediaRows: MediaRow[];
    try {
      if (c.channel.status !== 'active') {
        return this.fail(c, 'Канал недоступен: проверьте права бота в разделе «Каналы»');
      }
      const ids = c.content.media.map((m) => m.assetId);
      const found = c.ownerId ? await this.media.findMany(c.ownerId, ids) : [];
      const byId = new Map(found.map((m) => [m.id, m]));
      mediaRows = ids.map((id) => byId.get(id)).filter((m): m is MediaRow => !!m);
      const problems = validatePostContent(c.content, MediaService.infoMap(found));
      if (problems.length > 0) return this.fail(c, problems.map((p) => p.message).join('; '));
      // Файлы, ещё не загруженные в Telegram, должны быть на диске — иначе ошибка
      // возникла бы внутри запроса и выглядела бы как обрыв связи.
      for (const m of mediaRows) {
        if (!m.telegramFileId) await access(this.media.pathOf(m));
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      return this.fail(
        c,
        code === 'ENOENT'
          ? 'Медиафайл не найден на сервере — загрузите его заново'
          : `Ошибка подготовки: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    try {
      const { messageIds } = await this.publisher.send(
        Number(c.channel.tgChatId),
        c.content,
        mediaRows,
      );
      await this.db
        .update(publications)
        .set({
          status: 'published',
          messageIds,
          publishedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(publications.id, c.id));
      await this.finishAttempt(c.attemptId, 'ok');
      await this.analytics
        .recordPublished(c.channel.id, c.id, messageIds, c.content)
        .catch((err: Error) =>
          this.logger.warn({ err: err.message }, 'Сообщение не записано в аналитику'),
        );
      await this.audit.record({
        action: 'publication.sent',
        entityType: 'publication',
        entityId: c.id,
        metadata: { messageIds },
      });
      await this.notifications.notifyOwner({
        category: 'publishSuccess',
        text: `✅ Опубликовано в ${this.channelName(c.channel)}: «${summarizeContent(c.content, 60)}»`,
        dedupeKey: `published-${c.id}`,
      });
      return 'published';
    } catch (e) {
      if (!(e instanceof TelegramApiError)) {
        // Неизвестная ошибка во время отправки — нельзя утверждать, что пост не ушёл.
        return this.ambiguous(c, e instanceof Error ? e.message : String(e));
      }
      if (e.kind === 'rate_limited') {
        await this.finishAttempt(c.attemptId, 'rate_limited', {
          code: e.code,
          description: e.description,
        });
        await this.backToScheduled(c, (e.retryAfter ?? 5) * 1000, `rl${c.attempts}`);
        return 'rate_limited';
      }
      if (e.kind === 'permanent' || e.kind === 'unauthorized') {
        return this.fail(c, describeTelegramError(e), e.code);
      }
      if (!e.requestMayHaveBeenProcessed) {
        if (c.attempts <= SAFE_RETRY_DELAYS_MS.length) {
          await this.finishAttempt(c.attemptId, 'retryable', { description: e.description });
          await this.backToScheduled(c, SAFE_RETRY_DELAYS_MS[c.attempts - 1]!, `r${c.attempts}`);
          return 'retry_scheduled';
        }
        return this.fail(c, 'Нет связи с Telegram — повторы исчерпаны');
      }
      return this.ambiguous(c, e.description);
    }
  }

  private async ambiguous(c: Claimed, description: string): Promise<ExecuteOutcome> {
    await this.db
      .update(publications)
      .set({
        status: 'ambiguous',
        lastError: 'Связь с Telegram прервалась после отправки — неизвестно, опубликован ли пост',
        updatedAt: new Date(),
      })
      .where(eq(publications.id, c.id));
    await this.finishAttempt(c.attemptId, 'ambiguous', { description });
    await this.audit.record({
      action: 'publication.ambiguous',
      entityType: 'publication',
      entityId: c.id,
    });
    await this.notifications.notifyOwner({
      category: 'publishProblems',
      text:
        `⚠️ Неизвестно, опубликован ли пост в ${this.channelName(c.channel)} — связь с Telegram прервалась.\n` +
        'Проверьте канал и отметьте результат в приложении, чтобы не получить дубль.',
      openPath: `/posts/edit/?id=${c.postId}`,
      dedupeKey: `ambiguous-${c.id}-${c.attempts}`,
    });
    return 'ambiguous';
  }

  /**
   * Реконсилятор (раз в минуту):
   * — просроченные запланированные отправки без задания ставятся в очередь заново
   *   (после простоя сервера или потери данных Redis);
   * — «зависшие» в статусе sending переводятся в ambiguous.
   */
  async reconcile(now = new Date()): Promise<{ requeued: number; stuck: number }> {
    const overdue = await this.db
      .select({ id: publications.id, scheduledAt: publications.scheduledAt })
      .from(publications)
      .where(
        and(
          eq(publications.status, 'scheduled'),
          lt(publications.scheduledAt, new Date(now.getTime() - OVERDUE_MS)),
        ),
      )
      .limit(500);
    const bucket = Math.floor(now.getTime() / 60_000);
    for (const p of overdue) {
      await enqueuePublish(this.queue, p.id, p.scheduledAt, { delayMs: 0, suffix: `rec${bucket}` });
    }

    const stuck = await this.db
      .select({ p: publications, content: posts.content, channel: channels })
      .from(publications)
      .innerJoin(posts, eq(posts.id, publications.postId))
      .innerJoin(channels, eq(channels.id, publications.channelId))
      .where(
        and(
          eq(publications.status, 'sending'),
          lt(publications.updatedAt, new Date(now.getTime() - STUCK_SENDING_MS)),
        ),
      )
      .limit(100);
    for (const s of stuck) {
      const [attempt] = await this.db
        .insert(publicationAttempts)
        .values({ publicationId: s.p.id })
        .returning({ id: publicationAttempts.id });
      await this.ambiguous(
        {
          id: s.p.id,
          postId: s.p.postId,
          ownerId: s.p.ownerId,
          attempts: s.p.attempts,
          scheduledAt: s.p.scheduledAt,
          content: s.p.sentContent ?? s.content,
          channel: s.channel,
          attemptId: attempt!.id,
        },
        'Отправка прервалась (перезапуск процесса во время отправки)',
      );
    }
    if (overdue.length || stuck.length) {
      this.logger.log({ requeued: overdue.length, stuck: stuck.length }, 'Реконсилятор расписания');
    }
    return { requeued: overdue.length, stuck: stuck.length };
  }
}
