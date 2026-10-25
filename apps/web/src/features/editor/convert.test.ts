import { describe, expect, it } from 'vitest';
import { docToMessage, messageToDoc, type PMNode } from './convert';

const p = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const t = (text: string, ...marks: string[]): PMNode => ({
  type: 'text',
  text,
  ...(marks.length
    ? {
        marks: marks.map((m) =>
          m.startsWith('link:') ? { type: 'link', attrs: { href: m.slice(5) } } : { type: m },
        ),
      }
    : {}),
});
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

describe('docToMessage', () => {
  it('абзацы через \\n, отметки → entities, соседние участки склеиваются', () => {
    const r = docToMessage(
      doc(p(t('Привет, '), t('жир', 'bold'), t('ный', 'bold', 'italic')), p(t('строка 2'))),
    );
    expect(r.text).toBe('Привет, жирный\nстрока 2');
    expect(r.entities).toEqual([
      { type: 'bold', offset: 8, length: 6 },
      { type: 'italic', offset: 11, length: 3 },
    ]);
  });

  it('ссылка, спойлер, зачёркнутый, код', () => {
    const r = docToMessage(
      doc(
        p(
          t('сайт', 'link:https://e.ru'),
          t(' '),
          t('тайна', 'spoiler'),
          t(' '),
          t('x', 'strike'),
          t('y', 'code'),
        ),
      ),
    );
    expect(r.entities).toEqual([
      { type: 'text_link', offset: 0, length: 4, url: 'https://e.ru' },
      { type: 'spoiler', offset: 5, length: 5 },
      { type: 'strikethrough', offset: 11, length: 1 },
      { type: 'code', offset: 12, length: 1 },
    ]);
  });

  it('цитата и блок кода', () => {
    const r = docToMessage(
      doc(
        p(t('до')),
        { type: 'blockquote', content: [p(t('цитата')), p(t('вторая'))] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'a\nb' }] },
      ),
    );
    expect(r.text).toBe('до\nцитата\nвторая\na\nb');
    expect(r.entities).toEqual([
      { type: 'blockquote', offset: 3, length: 13 },
      { type: 'pre', offset: 17, length: 3 },
    ]);
  });

  it('пустые абзацы по краям обрезаются со сдвигом entities', () => {
    const r = docToMessage(
      doc({ type: 'paragraph' }, p(t('  жирный', 'bold')), { type: 'paragraph' }),
    );
    expect(r.text).toBe('жирный');
    expect(r.entities).toEqual([{ type: 'bold', offset: 0, length: 6 }]);
  });

  it('эмодзи: смещения в UTF-16', () => {
    const r = docToMessage(doc(p(t('😀 '), t('ок', 'bold'))));
    expect(r.entities).toEqual([{ type: 'bold', offset: 3, length: 2 }]);
  });
});

describe('messageToDoc ⇄ docToMessage', () => {
  const samples: [string, Parameters<typeof messageToDoc>[1]][] = [
    ['Просто текст', []],
    [
      'Привет, жирный\nстрока 2',
      [
        { type: 'bold', offset: 8, length: 6 },
        { type: 'italic', offset: 11, length: 3 },
      ],
    ],
    [
      'сайт тайна',
      [
        { type: 'text_link', offset: 0, length: 4, url: 'https://e.ru' },
        { type: 'spoiler', offset: 5, length: 5 },
      ],
    ],
    ['до\nцитата\nвторая\nпосле', [{ type: 'blockquote', offset: 3, length: 13 }]],
    ['код:\nline1\nline2', [{ type: 'pre', offset: 5, length: 11 }]],
    ['абзац\n\nпосле пустой', [{ type: 'underline', offset: 7, length: 5 }]],
    ['😀 ок', [{ type: 'bold', offset: 3, length: 2 }]],
  ];
  it.each(samples)('%s — без потерь', (text, entities) => {
    expect(docToMessage(messageToDoc(text, entities))).toEqual({ text, entities });
  });
});
