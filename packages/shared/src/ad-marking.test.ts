import { describe, expect, it } from 'vitest';
import { adMarkingLine, adMarkingMissing } from './ad-marking';

describe('маркировка рекламы', () => {
  it('строка маркировки и проверка', () => {
    const ad = { advertiser: 'ООО «Зерно»', inn: '1655000000', erid: '2SDnje1' };
    const line = adMarkingLine(ad);
    expect(line).toBe('Реклама. ООО «Зерно», ИНН 1655000000. erid: 2SDnje1');
    expect(adMarkingMissing(`${line}\n\nТекст`, ad)).toEqual([]);
    expect(adMarkingMissing('Текст', ad)).toEqual(['label', 'erid', 'advertiser']);
    expect(adMarkingMissing('Текст', { noErid: true })).toEqual([]);
  });
});
