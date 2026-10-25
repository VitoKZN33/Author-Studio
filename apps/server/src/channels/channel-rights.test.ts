import type { ChatMember } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import {
  ChannelRefError,
  missingRecommendedRights,
  missingRequiredRights,
  parseChannelRef,
  rightsFromMember,
  statusFromRights,
} from './channel-rights.js';

const bot = { id: 1, is_bot: true, first_name: 'bot' };
function admin(rights: Partial<Record<string, boolean>>): ChatMember {
  return {
    status: 'administrator',
    user: bot,
    can_be_edited: false,
    is_anonymous: false,
    can_manage_chat: true,
    can_delete_messages: false,
    can_manage_video_chats: false,
    can_restrict_members: false,
    can_promote_members: false,
    can_change_info: false,
    can_invite_users: false,
    can_post_stories: false,
    can_edit_stories: false,
    can_delete_stories: false,
    ...rights,
  } as ChatMember;
}

describe('права бота', () => {
  it('все обязательные права → active', () => {
    const r = rightsFromMember(
      admin({ can_post_messages: true, can_edit_messages: true, can_delete_messages: true }),
    );
    expect(statusFromRights(r)).toBe('active');
    expect(missingRequiredRights(r)).toEqual([]);
    expect(missingRecommendedRights(r)).toEqual(['canInviteUsers']);
  });

  it('нет права удаления → rights_missing с перечнем', () => {
    const r = rightsFromMember(admin({ can_post_messages: true, can_edit_messages: true }));
    expect(statusFromRights(r)).toBe('rights_missing');
    expect(missingRequiredRights(r)).toEqual(['canDeleteMessages']);
  });

  it('бот не администратор → bot_removed', () => {
    const r = rightsFromMember({ status: 'left', user: bot });
    expect(r.isAdmin).toBe(false);
    expect(statusFromRights(r)).toBe('bot_removed');
  });
});

describe('parseChannelRef', () => {
  it.each([
    ['@my_channel', '@my_channel'],
    ['my_channel', '@my_channel'],
    ['https://t.me/my_channel', '@my_channel'],
    ['t.me/my_channel/', '@my_channel'],
  ])('%s → username', (input, expected) => {
    expect(parseChannelRef(input)).toEqual({ kind: 'username', value: expected });
  });

  it('числовой ID канала', () => {
    expect(parseChannelRef('-1001234567890')).toEqual({ kind: 'id', value: -1001234567890 });
  });

  it('приватная ссылка-приглашение и мусор отклоняются с пояснением', () => {
    expect(() => parseChannelRef('https://t.me/+AbCdEf')).toThrow(ChannelRefError);
    expect(() => parseChannelRef('t.me/joinchat/AbCd')).toThrow(/Приватную ссылку/);
    expect(() => parseChannelRef('не канал')).toThrow(ChannelRefError);
    expect(() => parseChannelRef('@ab')).toThrow(ChannelRefError);
  });
});
