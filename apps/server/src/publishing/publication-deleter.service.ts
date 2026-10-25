import { Inject, Injectable, Logger } from '@nestjs/common';
import { summarizeContent } from '@author-studio/shared';
import { and, eq, lte } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DB, type Database } from '../database/database.module.js';
import { channels, posts, publications } from '../database/schema.js';
import { MTPROTO_GATEWAY, MtprotoError, type MtprotoGateway } from '../mtproto/gateway.js';
import { MTPROTO_MESSAGES, MtprotoStore } from '../mtproto/mtproto.store.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TELEGRAM_CLIENT } from '../telegram/telegram.module.js';
import { TelegramApiError, type TelegramClient } from '../telegram/telegram-client.js';

/**
 * Удаление постов по сроку публикации («1/24», «1/48» и т. п.). Сначала — ботом
 * (deleteMessages); если Telegram не дал (например, пост старше 48 часов), — через
 * подключённый аккаунт владельца. Если не вышло никак — владельцу уходит просьба
 * удалить вручную, статус «не удалось».
 */
@Injectable()
export class PublicationDeleter {
  private readonly logger = new Logger(PublicationDeleter.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TELEGRAM_CLIENT) private readonly telegram: TelegramClient | null,
    @Inject(MTPROTO_GATEWAY) private readonly gateway: MtprotoGateway,
    private readonly mtproto: MtprotoStore,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async runDue(now = new Date()): Promise<number> {
    const due = await this.db
      .select({ p: publications, channel: channels, content: posts.content })
      .from(publications)
      .innerJoin(channels, eq(channels.id, publications.channelId))
      .innerJoin(posts, eq(posts.id, publications.postId))
      .where(
        and(
          eq(publications.status, 'published'),
          eq(publications.deleteStatus, 'pending'),
          lte(publications.deleteAt, now),
        ),
      )
      .limit(20);
    let done = 0;
    for (const d of due) if (await this.deleteOne(d)) done++;
    return done;
  }

  private async deleteOne(d: {
    p: typeof publications.$inferSelect;
    channel: typeof channels.$inferSelect;
    content: typeof posts.$inferSelect.content;
  }): Promise<boolean> {
    const ids = d.p.messageIds ?? [];
    const summary = summarizeContent(d.p.sentContent ?? d.content, 60);
    let via: 'bot' | 'account' | null = null;
    let error = '';
    if (ids.length === 0) via = 'bot';
    if (!via && this.telegram) {
      try {
        await this.telegram.call('deleteMessages', (api) =>
          api.deleteMessages(Number(d.channel.tgChatId), ids),
        );
        via = 'bot';
      } catch (e) {
        error = e instanceof TelegramApiError ? e.message : String(e);
      }
    }
    if (!via) {
      const s = await this.mtproto.secrets();
      if (s && s.row.status !== 'error') {
        try {
          await this.gateway.deleteMessages(
            s.creds,
            s.session,
            { chatId: d.channel.tgChatId, username: d.channel.username },
            ids,
          );
          via = 'account';
        } catch (e) {
          const err = e instanceof MtprotoError ? e : new MtprotoError('unknown', String(e));
          error = `${error}; через аккаунт: ${MTPROTO_MESSAGES[err.code] ?? err.code}`;
        }
      }
    }

    if (via) {
      await this.db
        .update(publications)
        .set({
          deleteStatus: 'deleted',
          deletedAt: new Date(),
          deleteError: null,
          updatedAt: new Date(),
        })
        .where(eq(publications.id, d.p.id));
      await this.audit.record({
        action: 'publication.deleted_by_schedule',
        entityType: 'publication',
        entityId: d.p.id,
        metadata: { via, hours: d.p.deleteAfterHours },
      });
      await this.notifications
        .notifyOwner({
          category: 'publishSuccess',
          text: `🗑 Удалён по сроку (${d.p.deleteAfterHours} ч) из «${d.channel.title}»: «${summary}»`,
          openPath: `/posts/view/?id=${d.p.postId}`,
        })
        .catch(() => undefined);
      return true;
    }

    this.logger.warn({ publicationId: d.p.id, error }, 'Пост не удалён по сроку');
    await this.db
      .update(publications)
      .set({
        deleteStatus: 'failed',
        deleteError: error.slice(0, 500) || 'Telegram не дал удалить сообщение',
        updatedAt: new Date(),
      })
      .where(eq(publications.id, d.p.id));
    await this.notifications
      .notifyOwner({
        category: 'publishProblems',
        text: `⚠️ Срок публикации истёк, но удалить пост из «${d.channel.title}» не получилось — удалите его вручную: «${summary}»`,
        openPath: `/posts/view/?id=${d.p.postId}`,
      })
      .catch(() => undefined);
    return false;
  }
}
