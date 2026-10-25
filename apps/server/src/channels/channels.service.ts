import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { ChatMemberUpdated } from 'grammy/types';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { DB, type Database } from '../database/database.module.js';
import { channels, users, type BotRightsSnapshot } from '../database/schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { METRICS_QUEUE } from '../queue/queue.module.js';
import type { Queue } from 'bullmq';
import { TELEGRAM_CLIENT } from '../telegram/telegram.module.js';
import { TelegramApiError, type TelegramClient } from '../telegram/telegram-client.js';
import {
  ChannelRefError,
  missingRecommendedRights,
  missingRequiredRights,
  parseChannelRef,
  RIGHT_LABELS,
  rightsFromMember,
  statusFromRights,
  type RightKey,
} from './channel-rights.js';

export type ChannelRow = typeof channels.$inferSelect;

export interface ChannelView {
  id: string;
  title: string;
  username: string | null;
  status: ChannelRow['status'];
  rights: BotRightsSnapshot | null;
  missingRequired: RightKey[];
  missingRecommended: RightKey[];
  rightsCheckedAt: string | null;
  connectedAt: string | null;
}

export function toView(row: ChannelRow): ChannelView {
  return {
    id: row.id,
    title: row.title,
    username: row.username,
    status: row.status,
    rights: row.botRights,
    missingRequired: row.botRights ? missingRequiredRights(row.botRights) : [],
    missingRecommended: row.botRights ? missingRecommendedRights(row.botRights) : [],
    rightsCheckedAt: row.rightsCheckedAt?.toISOString() ?? null,
    connectedAt: row.connectedAt?.toISOString() ?? null,
  };
}

function channelName(row: { title: string; username: string | null }): string {
  return row.username ? `«${row.title}» (@${row.username})` : `«${row.title}»`;
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(TELEGRAM_CLIENT) private readonly telegram: TelegramClient | null,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(METRICS_QUEUE) private readonly metricsQueue: Queue,
  ) {}

  private client(): TelegramClient {
    if (!this.telegram) {
      throw new ServiceUnavailableException('Бот не настроен: задайте TELEGRAM_BOT_TOKEN в .env');
    }
    return this.telegram;
  }

  /** Перевод ошибок Bot API в понятные HTTP-ответы. */
  private toHttp(err: unknown): never {
    if (err instanceof HttpException) throw err;
    if (err instanceof TelegramApiError) {
      if (err.matches('chat not found') || err.matches('member not found')) {
        throw new NotFoundException(
          'Канал не найден. Проверьте адрес и что бот добавлен в канал администратором',
        );
      }
      if (err.matches('bot is not a member') || err.matches('bot was kicked')) {
        throw new BadRequestException('Бот не состоит в канале. Добавьте его администратором');
      }
      if (err.kind === 'rate_limited') {
        throw new ServiceUnavailableException(
          `Telegram ограничил частоту запросов. Повторите через ${err.retryAfter ?? 5} с`,
        );
      }
      if (err.kind === 'unauthorized') {
        throw new ServiceUnavailableException(
          'Telegram отклонил токен бота. Проверьте TELEGRAM_BOT_TOKEN',
        );
      }
      if (err.kind === 'transient') {
        throw new ServiceUnavailableException('Telegram временно недоступен. Повторите позже');
      }
      this.logger.warn({ err: err.message }, 'Неожиданный ответ Telegram');
      throw new BadRequestException('Telegram отклонил запрос. Проверьте канал и права бота');
    }
    throw err;
  }

  async list(ownerId: string): Promise<ChannelView[]> {
    const rows = await this.db
      .select()
      .from(channels)
      .where(eq(channels.ownerId, ownerId))
      .orderBy(asc(channels.title));
    return rows.map(toView);
  }

  private async findOwned(ownerId: string, id: string): Promise<ChannelRow> {
    const [row] = await this.db
      .select()
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.ownerId, ownerId)))
      .limit(1);
    if (!row) throw new NotFoundException('Канал не найден');
    return row;
  }

  /** Проверяет канал в Telegram: тип, права бота, что владелец — администратор. */
  private async inspect(chatRef: string | number, ownerTelegramId: bigint) {
    const tg = this.client();
    const chat = await tg.call('getChat', (api) => api.getChat(chatRef));
    if (chat.type !== 'channel') {
      throw new BadRequestException('Это не канал. Поддерживаются только Telegram-каналы');
    }
    const botMember = await tg.call('getChatMember', (api) => api.getChatMember(chat.id, tg.botId));
    const rights = rightsFromMember(botMember);
    if (!rights.isAdmin) {
      throw new BadRequestException(
        'Бот не является администратором канала. Добавьте его администратором',
      );
    }
    const ownerMember = await tg.call('getChatMember', (api) =>
      api.getChatMember(chat.id, Number(ownerTelegramId)),
    );
    if (ownerMember.status !== 'creator' && ownerMember.status !== 'administrator') {
      throw new ForbiddenException(
        'Подключать можно только каналы, где вы являетесь администратором',
      );
    }
    return { chat, rights };
  }

  async connect(ownerId: string, ownerTelegramId: bigint, input: string): Promise<ChannelView> {
    let ref;
    try {
      ref = parseChannelRef(input);
    } catch (e) {
      if (e instanceof ChannelRefError) throw new BadRequestException(e.message);
      throw e;
    }
    try {
      const { chat, rights } = await this.inspect(ref.value, ownerTelegramId);
      return await this.saveConnected(ownerId, chat, rights);
    } catch (e) {
      this.toHttp(e);
    }
  }

  async connectDetected(
    ownerId: string,
    ownerTelegramId: bigint,
    id: string,
  ): Promise<ChannelView> {
    const row = await this.findOwned(ownerId, id);
    try {
      const { chat, rights } = await this.inspect(Number(row.tgChatId), ownerTelegramId);
      return await this.saveConnected(ownerId, chat, rights);
    } catch (e) {
      this.toHttp(e);
    }
  }

  private async saveConnected(
    ownerId: string,
    chat: { id: number; title?: string; username?: string },
    rights: BotRightsSnapshot,
  ): Promise<ChannelView> {
    const now = new Date();
    const title = chat.title || 'Без названия';
    const username = chat.username ?? null;
    const status = statusFromRights(rights);
    const [row] = await this.db
      .insert(channels)
      .values({
        ownerId,
        tgChatId: BigInt(chat.id),
        title,
        username,
        status,
        botRights: rights,
        rightsCheckedAt: now,
        connectedAt: now,
      })
      .onConflictDoUpdate({
        target: channels.tgChatId,
        set: {
          ownerId,
          title,
          username,
          status,
          botRights: rights,
          rightsCheckedAt: now,
          connectedAt: now,
          updatedAt: now,
        },
      })
      .returning();
    await this.audit.record({
      action: 'channel.connected',
      actorUserId: ownerId,
      entityType: 'channel',
      entityId: row!.id,
      metadata: { status, missing: missingRequiredRights(rights) },
    });
    // Первый снимок числа подписчиков — сразу после подключения.
    await this.metricsQueue
      .add(
        'collect-channel',
        { channelId: row!.id },
        { jobId: `collect-${row!.id}-${Math.floor(Date.now() / 60_000)}` },
      )
      .catch(() => undefined);
    return toView(row!);
  }

  async recheck(ownerId: string, id: string): Promise<ChannelView> {
    const row = await this.findOwned(ownerId, id);
    const tg = this.client();
    let rights: BotRightsSnapshot;
    let title = row.title;
    let username = row.username;
    try {
      const chat = await tg.call('getChat', (api) => api.getChat(Number(row.tgChatId)));
      if ('title' in chat && chat.title) title = chat.title;
      username = 'username' in chat ? (chat.username ?? null) : null;
      rights = rightsFromMember(
        await tg.call('getChatMember', (api) => api.getChatMember(Number(row.tgChatId), tg.botId)),
      );
    } catch (e) {
      // Бот удалён из канала: Telegram отвечает ошибкой доступа к чату.
      if (e instanceof TelegramApiError && e.kind === 'permanent') {
        rights = rightsFromMember({
          status: 'left',
          user: { id: tg.botId, is_bot: true, first_name: '' },
        });
      } else {
        this.toHttp(e);
      }
    }
    const status =
      row.status === 'disconnected' || row.status === 'detected'
        ? row.status
        : statusFromRights(rights);
    const [updated] = await this.db
      .update(channels)
      .set({
        title,
        username,
        status,
        botRights: rights,
        rightsCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(channels.id, row.id))
      .returning();
    if (updated!.status !== row.status) {
      await this.audit.record({
        action: 'channel.status_changed',
        actorUserId: ownerId,
        entityType: 'channel',
        entityId: row.id,
        metadata: { from: row.status, to: updated!.status },
      });
    }
    return toView(updated!);
  }

  async disconnect(ownerId: string, id: string): Promise<ChannelView> {
    const row = await this.findOwned(ownerId, id);
    const [updated] = await this.db
      .update(channels)
      .set({ status: 'disconnected', connectedAt: null, updatedAt: new Date() })
      .where(eq(channels.id, row.id))
      .returning();
    await this.audit.record({
      action: 'channel.disconnected',
      actorUserId: ownerId,
      entityType: 'channel',
      entityId: row.id,
    });
    return toView(updated!);
  }

  /**
   * Обработка my_chat_member в канале (вызывается worker'ом).
   * Каналы, куда бота добавил не владелец, игнорируются.
   */
  async onBotMembershipChanged(update: ChatMemberUpdated): Promise<void> {
    if (update.chat.type !== 'channel') return;
    const ownerTelegramId = this.config.OWNER_TELEGRAM_ID
      ? BigInt(this.config.OWNER_TELEGRAM_ID)
      : null;
    if (!ownerTelegramId) return;

    const chat = update.chat;
    const rights = rightsFromMember(update.new_chat_member);
    const [existing] = await this.db
      .select()
      .from(channels)
      .where(eq(channels.tgChatId, BigInt(chat.id)))
      .limit(1);
    const now = new Date();
    const title = chat.title;
    const username = chat.username ?? null;

    const isConnected =
      existing &&
      (existing.status === 'active' ||
        existing.status === 'rights_missing' ||
        existing.status === 'bot_removed');

    if (isConnected) {
      const status = statusFromRights(rights);
      await this.db
        .update(channels)
        .set({ title, username, status, botRights: rights, rightsCheckedAt: now, updatedAt: now })
        .where(eq(channels.id, existing.id));
      if (status !== existing.status) {
        await this.audit.record({
          action: 'channel.status_changed',
          entityType: 'channel',
          entityId: existing.id,
          metadata: { from: existing.status, to: status, source: 'telegram' },
        });
        await this.notifyStatus({ ...existing, title, username }, status, rights);
      } else if (status === 'rights_missing') {
        await this.notifyStatus({ ...existing, title, username }, status, rights);
      }
      return;
    }

    // Новый канал: учитываем, только если бота добавил владелец и сделал администратором.
    if (BigInt(update.from.id) !== ownerTelegramId || !rights.isAdmin) {
      if (rights.isAdmin) {
        this.logger.warn(
          { chatId: chat.id },
          'Бот добавлен в канал не владельцем установки — канал игнорируется',
        );
      }
      if (existing?.status === 'detected' && !rights.isAdmin) {
        await this.db.delete(channels).where(eq(channels.id, existing.id));
      }
      return;
    }

    // Владелец мог ещё ни разу не входить в Mini App — создаём его запись.
    const [owner] = await this.db
      .insert(users)
      .values({ telegramId: ownerTelegramId, role: 'owner' })
      .onConflictDoUpdate({ target: users.telegramId, set: { updatedAt: now } })
      .returning({ id: users.id });
    const [row] = await this.db
      .insert(channels)
      .values({
        ownerId: owner?.id ?? null,
        tgChatId: BigInt(chat.id),
        title,
        username,
        status: existing?.status === 'disconnected' ? 'disconnected' : 'detected',
        botRights: rights,
        rightsCheckedAt: now,
      })
      .onConflictDoUpdate({
        target: channels.tgChatId,
        set: { title, username, botRights: rights, rightsCheckedAt: now, updatedAt: now },
      })
      .returning();
    if (row!.status === 'detected') {
      await this.notifications.notifyOwner({
        category: 'integration',
        text: `Бот добавлен в канал ${channelName(row!)}. Откройте приложение, чтобы подключить канал.`,
        openPath: '/channels/',
        dedupeKey: `detected-${chat.id}`,
      });
    }
  }

  private async notifyStatus(
    row: { title: string; username: string | null; tgChatId: bigint },
    status: ChannelRow['status'],
    rights: BotRightsSnapshot,
  ) {
    const name = channelName(row);
    let text: string;
    if (status === 'bot_removed') {
      text = `⚠️ Бот удалён из канала ${name} или лишён прав администратора. Публикации в этот канал сейчас невозможны.`;
    } else if (status === 'rights_missing') {
      const missing = missingRequiredRights(rights)
        .map((k) => RIGHT_LABELS[k])
        .join(', ');
      text = `⚠️ В канале ${name} боту не хватает прав: ${missing}. Выдайте их в настройках администраторов канала.`;
    } else {
      text = `✅ Канал ${name} снова доступен: у бота есть все необходимые права.`;
    }
    await this.notifications.notifyOwner({
      category: 'integration',
      text,
      openPath: '/channels/',
      dedupeKey: `status-${row.tgChatId}-${status}`,
    });
  }
}
