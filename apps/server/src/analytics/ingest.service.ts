import { Inject, Injectable, Logger } from '@nestjs/common';
import { summarizeContent, type PostContent } from '@author-studio/shared';
import { eq } from 'drizzle-orm';
import type { ChatMemberUpdated, Message, MessageReactionCountUpdated } from 'grammy/types';
import { DB, type Database } from '../database/database.module.js';
import {
  channelMemberEvents,
  channelMessages,
  channelMetricSnapshots,
  channels,
  messageMetricSnapshots,
} from '../database/schema.js';

const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member']);

function isMember(m: ChatMemberUpdated['new_chat_member']): boolean {
  return MEMBER_STATUSES.has(m.status) || (m.status === 'restricted' && m.is_member);
}

function summarizeMessage(m: Message): string {
  const text = m.text ?? m.caption ?? '';
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  if (line) return line.length > 80 ? `${line.slice(0, 79)}…` : line;
  if (m.photo) return 'Фото';
  if (m.video) return 'Видео';
  return 'Сообщение';
}

/** Запись поступающих данных Telegram в таблицы аналитики. */
@Injectable()
export class AnalyticsIngestService {
  private readonly logger = new Logger(AnalyticsIngestService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  private async channelByChat(chatId: number) {
    const [c] = await this.db
      .select()
      .from(channels)
      .where(eq(channels.tgChatId, BigInt(chatId)))
      .limit(1);
    // Учитываем только подключённые каналы (не обнаруженные и не отключённые).
    return c && c.status !== 'detected' && c.status !== 'disconnected' ? c : null;
  }

  async recordSubscribers(channelId: string, value: number): Promise<void> {
    await this.db
      .insert(channelMetricSnapshots)
      .values({ channelId, metric: 'subscribers', value, source: 'telegram_api' });
  }

  async recordPublished(
    channelId: string,
    publicationId: string,
    messageIds: number[],
    content: PostContent,
  ): Promise<void> {
    const summary = summarizeContent(content);
    const postedAt = new Date();
    await this.db
      .insert(channelMessages)
      .values(
        messageIds.map((messageId) => ({
          channelId,
          messageId,
          postedAt,
          publicationId,
          summary,
          hasMedia: content.media.length > 0,
          source: 'app',
        })),
      )
      .onConflictDoUpdate({
        target: [channelMessages.channelId, channelMessages.messageId],
        set: { publicationId },
      });
  }

  async onChannelPost(m: Message): Promise<void> {
    const c = await this.channelByChat(m.chat.id);
    if (!c) return;
    await this.db
      .insert(channelMessages)
      .values({
        channelId: c.id,
        messageId: m.message_id,
        postedAt: new Date(m.date * 1000),
        mediaGroupId: m.media_group_id ?? null,
        summary: summarizeMessage(m),
        hasMedia: !!(m.photo || m.video || m.document || m.animation),
        source: 'telegram',
      })
      // Сообщение уже записано при публикации из приложения — дополняем группу альбома.
      .onConflictDoUpdate({
        target: [channelMessages.channelId, channelMessages.messageId],
        set: { mediaGroupId: m.media_group_id ?? null },
      });
  }

  async onReactionCount(u: MessageReactionCountUpdated): Promise<void> {
    const c = await this.channelByChat(u.chat.id);
    if (!c) return;
    const details: Record<string, number> = {};
    let total = 0;
    for (const r of u.reactions) {
      const key =
        r.type.type === 'emoji'
          ? r.type.emoji
          : r.type.type === 'custom_emoji'
            ? `custom:${r.type.custom_emoji_id}`
            : 'paid';
      details[key] = (details[key] ?? 0) + r.total_count;
      total += r.total_count;
    }
    await this.db.insert(messageMetricSnapshots).values({
      channelId: c.id,
      messageId: u.message_id,
      metric: 'reactions',
      value: total,
      details,
      measuredAt: new Date(u.date * 1000),
      source: 'telegram_api',
    });
  }

  /** Вступление/выход подписчика. Данные пользователя не сохраняются. */
  async onChatMember(u: ChatMemberUpdated, botId: number): Promise<void> {
    if (u.chat.type !== 'channel' || u.new_chat_member.user.id === botId) return;
    const was = isMember(u.old_chat_member);
    const now = isMember(u.new_chat_member);
    if (was === now) return;
    const c = await this.channelByChat(u.chat.id);
    if (!c) return;
    await this.db.insert(channelMemberEvents).values({
      channelId: c.id,
      kind: now ? 'join' : 'leave',
      occurredAt: new Date(u.date * 1000),
      inviteLinkName: now ? (u.invite_link?.name ?? null) : null,
    });
  }
}
