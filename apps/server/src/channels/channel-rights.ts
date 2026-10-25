import type { ChatMember } from 'grammy/types';
import type { BotRightsSnapshot } from '../database/schema.js';

/** Права, без которых не работают публикации и реклама (публикация, правка, закреп, удаление). */
export const REQUIRED_RIGHTS = ['canPostMessages', 'canEditMessages', 'canDeleteMessages'] as const;
/** Нужны для будущих функций (ссылки-приглашения для аналитики рекламы). */
export const RECOMMENDED_RIGHTS = ['canInviteUsers'] as const;

export type RightKey = (typeof REQUIRED_RIGHTS)[number] | (typeof RECOMMENDED_RIGHTS)[number];

export function rightsFromMember(member: ChatMember): BotRightsSnapshot {
  if (member.status !== 'administrator') {
    return {
      isAdmin: false,
      canPostMessages: false,
      canEditMessages: false,
      canDeleteMessages: false,
      canInviteUsers: false,
      canManageChat: false,
    };
  }
  return {
    isAdmin: true,
    canPostMessages: member.can_post_messages === true,
    canEditMessages: member.can_edit_messages === true,
    canDeleteMessages: member.can_delete_messages === true,
    canInviteUsers: member.can_invite_users === true,
    canManageChat: member.can_manage_chat === true,
  };
}

export function missingRequiredRights(r: BotRightsSnapshot): RightKey[] {
  return REQUIRED_RIGHTS.filter((k) => !r[k]);
}

export function missingRecommendedRights(r: BotRightsSnapshot): RightKey[] {
  return RECOMMENDED_RIGHTS.filter((k) => !r[k]);
}

export const RIGHT_LABELS: Record<RightKey, string> = {
  canPostMessages: 'Публикация сообщений',
  canEditMessages: 'Редактирование сообщений',
  canDeleteMessages: 'Удаление сообщений',
  canInviteUsers: 'Пригласительные ссылки',
};

export type ConnectedStatus = 'active' | 'rights_missing' | 'bot_removed';

export function statusFromRights(r: BotRightsSnapshot): ConnectedStatus {
  if (!r.isAdmin) return 'bot_removed';
  return missingRequiredRights(r).length === 0 ? 'active' : 'rights_missing';
}

/**
 * Разбор ссылки на канал: @username, username, https://t.me/username, t.me/username,
 * или числовой ID канала (-100…). Приватные пригласительные ссылки (t.me/+…)
 * Bot API разрешить не может — для них просим добавить бота и дождаться обнаружения.
 */
export type ChannelRef = { kind: 'username'; value: string } | { kind: 'id'; value: number };

export class ChannelRefError extends Error {}

export function parseChannelRef(input: string): ChannelRef {
  const s = input.trim();
  if (/^-100\d{5,15}$/.test(s)) return { kind: 'id', value: Number(s) };
  if (/^(https?:\/\/)?(t\.me|telegram\.me)\/(\+|joinchat\/)/i.test(s)) {
    throw new ChannelRefError(
      'Приватную ссылку-приглашение Telegram не раскрывает боту. Добавьте бота администратором — канал появится в списке «Обнаружены».',
    );
  }
  const m =
    /^(?:(?:https?:\/\/)?(?:t\.me|telegram\.me)\/|@)?([A-Za-z][A-Za-z0-9_]{3,31})\/?$/i.exec(s);
  if (m) return { kind: 'username', value: `@${m[1]}` };
  throw new ChannelRefError('Укажите @username канала, ссылку t.me/… или числовой ID (-100…)');
}
