import { describe, expect, it } from 'vitest';
import { groupOf, postLink, type PublicationView } from './types';

const pub = (status: PublicationView['status']) => ({ status }) as PublicationView;

describe('группы публикаций', () => {
  it('ошибка важнее расписания, расписание важнее опубликованного', () => {
    expect(groupOf({ publications: [] })).toBe('drafts');
    expect(groupOf({ publications: [pub('cancelled')] })).toBe('drafts');
    expect(groupOf({ publications: [pub('published'), pub('scheduled')] })).toBe('scheduled');
    expect(groupOf({ publications: [pub('published'), pub('ambiguous')] })).toBe('attention');
    expect(groupOf({ publications: [pub('published')] })).toBe('published');
  });

  it('ссылка на пост только для публичного канала', () => {
    expect(postLink({ channelUsername: 'news', messageIds: [42, 43] })).toBe(
      'https://t.me/news/42',
    );
    expect(postLink({ channelUsername: null, messageIds: [42] })).toBeNull();
  });
});
