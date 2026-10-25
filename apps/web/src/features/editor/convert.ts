import type { MessageEntity } from '@author-studio/shared';

/**
 * Преобразование между документом редактора (ProseMirror/TipTap JSON) и текстом
 * Telegram с entities. Смещения — в единицах UTF-16, как в JS-строках и Bot API.
 *
 * Поддерживаемая структура: абзацы, перенос строки, цитата (blockquote), блок кода (pre);
 * отметки: жирный, курсив, подчёркнутый, зачёркнутый, код, спойлер, ссылка.
 */

export interface PMNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: PMNode[];
}

const MARK_TO_ENTITY: Record<string, MessageEntity['type']> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikethrough',
  code: 'code',
  spoiler: 'spoiler',
  link: 'text_link',
};
const ENTITY_TO_MARK = Object.fromEntries(
  Object.entries(MARK_TO_ENTITY).map(([m, e]) => [e, m]),
) as Record<string, string>;

interface Range {
  type: MessageEntity['type'];
  start: number;
  end: number;
  url?: string;
}

function pushRange(ranges: Range[], r: Range) {
  if (r.end <= r.start) return;
  // Склеиваем соседние участки с той же отметкой (TipTap дробит текст на узлы).
  const prev = [...ranges]
    .reverse()
    .find((x) => x.type === r.type && x.url === r.url && x.end === r.start);
  if (prev) prev.end = r.end;
  else ranges.push(r);
}

export function docToMessage(doc: PMNode): { text: string; entities: MessageEntity[] } {
  let text = '';
  const ranges: Range[] = [];

  const inline = (nodes: PMNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'hardBreak') {
        text += '\n';
      } else if (n.type === 'text' && n.text) {
        const start = text.length;
        text += n.text;
        for (const m of n.marks ?? []) {
          const type = MARK_TO_ENTITY[m.type];
          if (!type) continue;
          const url = type === 'text_link' ? String(m.attrs?.href ?? '') : undefined;
          pushRange(ranges, { type, start, end: text.length, url });
        }
      }
    }
  };

  const blocks = doc.content ?? [];
  blocks.forEach((block, i) => {
    if (i > 0) text += '\n';
    if (block.type === 'paragraph') {
      inline(block.content);
    } else if (block.type === 'blockquote') {
      const start = text.length;
      (block.content ?? []).forEach((p, j) => {
        if (j > 0) text += '\n';
        inline(p.content);
      });
      pushRange(ranges, { type: 'blockquote', start, end: text.length });
    } else if (block.type === 'codeBlock') {
      const start = text.length;
      text += (block.content ?? []).map((t) => t.text ?? '').join('');
      pushRange(ranges, { type: 'pre', start, end: text.length });
    }
  });

  return normalize(text, ranges);
}

/** Telegram обрезает пробелы по краям сообщения — заранее обрезаем и сдвигаем entities. */
function normalize(raw: string, ranges: Range[]): { text: string; entities: MessageEntity[] } {
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim();
  const entities: MessageEntity[] = [];
  for (const r of ranges) {
    const start = Math.max(r.start - lead, 0);
    const end = Math.min(r.end - lead, text.length);
    if (end <= start) continue;
    entities.push({
      type: r.type,
      offset: start,
      length: end - start,
      ...(r.url !== undefined ? { url: r.url } : {}),
    });
  }
  entities.sort((a, b) => a.offset - b.offset || b.length - a.length);
  return { text, entities };
}

export function messageToDoc(text: string, entities: MessageEntity[]): PMNode {
  const lines = text.split('\n');
  const blockOf = (offset: number) =>
    entities.find(
      (e) =>
        (e.type === 'blockquote' || e.type === 'pre') &&
        offset >= e.offset &&
        offset < e.offset + e.length,
    );

  const inlineFor = (from: number, to: number): PMNode[] => {
    const marks = entities.filter(
      (e) => ENTITY_TO_MARK[e.type] && e.offset < to && e.offset + e.length > from,
    );
    const cuts = new Set([from, to]);
    for (const e of marks) {
      cuts.add(Math.max(e.offset, from));
      cuts.add(Math.min(e.offset + e.length, to));
    }
    const points = [...cuts].sort((a, b) => a - b);
    const nodes: PMNode[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (b <= a) continue;
      const active = marks.filter((e) => e.offset <= a && e.offset + e.length >= b);
      const node: PMNode = { type: 'text', text: text.slice(a, b) };
      if (active.length) {
        node.marks = active.map((e) =>
          e.type === 'text_link'
            ? { type: 'link', attrs: { href: e.url ?? '' } }
            : { type: ENTITY_TO_MARK[e.type]! },
        );
      }
      nodes.push(node);
    }
    return nodes;
  };

  const blocks: PMNode[] = [];
  let offset = 0;
  let current = null as { entity: MessageEntity; node: PMNode } | null;
  for (const line of lines) {
    const from = offset;
    const to = offset + line.length;
    const open: { entity: MessageEntity; node: PMNode } | null = current;
    const block: MessageEntity | undefined = line.length
      ? blockOf(from)
      : open && from < open.entity.offset + open.entity.length
        ? open.entity
        : undefined;
    if (block?.type === 'pre') {
      if (open && open.entity === block) {
        open.node.content![0]!.text += `\n${line}`;
      } else {
        current = {
          entity: block,
          node: { type: 'codeBlock', content: [{ type: 'text', text: line }] },
        };
        blocks.push(current.node);
      }
    } else if (block?.type === 'blockquote') {
      const paragraph: PMNode = {
        type: 'paragraph',
        ...(line ? { content: inlineFor(from, to) } : {}),
      };
      if (open && open.entity === block) {
        open.node.content!.push(paragraph);
      } else {
        current = { entity: block, node: { type: 'blockquote', content: [paragraph] } };
        blocks.push(current.node);
      }
    } else {
      current = null;
      blocks.push({ type: 'paragraph', ...(line ? { content: inlineFor(from, to) } : {}) });
    }
    offset = to + 1;
  }
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
}
