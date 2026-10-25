import { describe, expect, it } from 'vitest';
import { fromAiMarkup, hasLossyEntities, toAiMarkup } from './ai-text';

describe('ai-text', () => {
  it('bold и ссылки туда и обратно', () => {
    const text = 'Привет, мир! Читайте тут.';
    const entities = [
      { type: 'bold' as const, offset: 0, length: 6 },
      { type: 'text_link' as const, offset: 21, length: 3, url: 'https://ex.ru/a' },
    ];
    const markup = toAiMarkup(text, entities);
    expect(markup).toBe('**Привет**, мир! Читайте [тут](https://ex.ru/a).');
    expect(fromAiMarkup(markup)).toEqual({ text, entities });
  });

  it('смещения в UTF-16 с эмодзи', () => {
    const r = fromAiMarkup('🔥 **Горячо**');
    expect(r.text).toBe('🔥 Горячо');
    expect(r.entities).toEqual([{ type: 'bold', offset: 3, length: 6 }]);
  });

  it('незакрытые ** остаются текстом; заголовки и маркеры списка упрощаются', () => {
    expect(fromAiMarkup('a ** b').text).toBe('a ** b');
    expect(fromAiMarkup('# Заголовок\n* пункт').text).toBe('Заголовок\n• пункт');
  });

  it('ссылки только http(s)', () => {
    expect(fromAiMarkup('[x](javascript:alert(1))').entities).toEqual([]);
  });

  it('курсив и спойлер считаются потерей форматирования', () => {
    expect(hasLossyEntities([{ type: 'bold', offset: 0, length: 1 }])).toBe(false);
    expect(hasLossyEntities([{ type: 'italic', offset: 0, length: 1 }])).toBe(true);
  });
});
