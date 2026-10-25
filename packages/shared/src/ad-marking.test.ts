import { describe, expect, it } from 'vitest';
import { adMarkingMissing, hasAdHashtag } from './ad-marking';

describe('пометка рекламы', () => {
  it('нужен хэштег #реклама', () => {
    expect(adMarkingMissing('Скидки\n\n#реклама')).toEqual([]);
    expect(adMarkingMissing('#Реклама скидки')).toEqual([]);
    expect(adMarkingMissing('Реклама. Скидки')).toEqual(['label']);
    expect(hasAdHashtag('#рекламации')).toBe(false);
    expect(hasAdHashtag('site.ru/#реклама')).toBe(false);
  });
});
