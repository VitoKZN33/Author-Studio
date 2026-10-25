import type { MessageEntity } from './post-content';

/**
 * Обмен текстом с AI. Модель видит и пишет простую разметку из двух конструкций:
 * **жирный** и [текст](https://ссылка). Остальное форматирование Telegram
 * (курсив, спойлер, код и т. п.) при обработке AI теряется — интерфейс предупреждает.
 */

/** Есть ли в тексте форматирование, которое не переживёт обработку AI. */
export function hasLossyEntities(entities: readonly MessageEntity[]): boolean {
  return entities.some((e) => e.type !== 'bold' && e.type !== 'text_link');
}

/** Текст + entities → разметка для модели (только bold и text_link). */
export function toAiMarkup(text: string, entities: readonly MessageEntity[]): string {
  type Mark = { at: number; order: number; s: string };
  const marks: Mark[] = [];
  for (const e of entities) {
    const end = e.offset + e.length;
    if (e.type === 'bold') {
      marks.push({ at: e.offset, order: 1, s: '**' }, { at: end, order: 0, s: '**' });
    } else if (e.type === 'text_link' && e.url) {
      marks.push({ at: e.offset, order: 1, s: '[' }, { at: end, order: 0, s: `](${e.url})` });
    }
  }
  // Сначала закрытия, потом открытия в одной позиции — без перекрёстной разметки.
  marks.sort((a, b) => b.at - a.at || b.order - a.order);
  let out = text;
  for (const m of marks) out = out.slice(0, m.at) + m.s + out.slice(m.at);
  return out;
}

const LINK_RE = /^\[([^\]\n]{1,500})\]\((https?:\/\/[^\s)]{1,2000})\)/;

/**
 * Разметка от модели → текст + entities. Незакрытые ** остаются как есть;
 * заголовки Markdown (#) и маркеры списков «* » приводятся к простому тексту.
 */
export function fromAiMarkup(input: string): { text: string; entities: MessageEntity[] } {
  const src = input
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*-]\s+(?=\S)/gm, '• ')
    .trim();
  let text = '';
  const entities: MessageEntity[] = [];
  let boldStart: number | null = null;
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('**', i)) {
      if (boldStart === null) {
        // Открываем, только если дальше есть закрывающие **.
        if (src.indexOf('**', i + 2) > i + 2) {
          boldStart = text.length;
          i += 2;
          continue;
        }
      } else {
        if (text.length > boldStart)
          entities.push({ type: 'bold', offset: boldStart, length: text.length - boldStart });
        boldStart = null;
        i += 2;
        continue;
      }
    }
    if (src[i] === '[') {
      const m = LINK_RE.exec(src.slice(i));
      if (m) {
        const offset = text.length;
        text += m[1]!;
        entities.push({ type: 'text_link', offset, length: m[1]!.length, url: m[2]! });
        i += m[0].length;
        continue;
      }
    }
    text += src[i];
    i++;
  }
  return { text, entities: entities.sort((a, b) => a.offset - b.offset) };
}
