import { describe, expect, it } from 'vitest';
import { contentMeta, hashtagsOf, isAdText } from './content-meta.js';

describe('content-meta', () => {
  it('хэштеги: кириллица, регистр, без дублей и якорей в ссылках', () => {
    expect(hashtagsOf('Новости #Казань и #казань, #кофе_дома. https://ex.ru/#anchor')).toEqual([
      'казань',
      'кофе_дома',
    ]);
  });
  it('реклама: erid, строка «Реклама», #реклама', () => {
    expect(isAdText('Реклама. ООО «Ромашка», ИНН 123\nТекст')).toBe(true);
    expect(isAdText('Скидки! erid: 2SDnjeXyz')).toBe(true);
    expect(isAdText('Пост #реклама')).toBe(true);
    expect(isAdText('Нерекламный пост про рекламу')).toBe(false);
  });
  it('тип контента', () => {
    expect(contentMeta('т', { photos: 0, videos: 0 }).contentKind).toBe('text');
    expect(contentMeta('т', { photos: 1, videos: 0 }).contentKind).toBe('photo');
    expect(contentMeta('т', { photos: 1, videos: 1 }).contentKind).toBe('album');
    expect(contentMeta('т', { photos: 0, videos: 1 }).contentKind).toBe('video');
  });
});
