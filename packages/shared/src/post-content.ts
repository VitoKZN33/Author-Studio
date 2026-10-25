import { z } from 'zod';
import { TELEGRAM_LIMITS } from './telegram-limits';

/**
 * Содержимое публикации в форме, близкой к Bot API: текст + entities (смещения в
 * единицах UTF-16, как в JavaScript-строках), медиа по ссылкам на загруженные файлы,
 * URL-кнопки. Это каноническая форма: редактор строится из неё и сохраняет в неё.
 */

export const ENTITY_TYPES = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'spoiler',
  'code',
  'pre',
  'text_link',
  'blockquote',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const entitySchema = z.object({
  type: z.enum(ENTITY_TYPES),
  offset: z.number().int().min(0),
  length: z.number().int().min(1),
  url: z.string().max(2048).optional(),
});
export type MessageEntity = z.infer<typeof entitySchema>;

export const mediaItemSchema = z.object({
  assetId: z.uuid(),
});

export const buttonSchema = z.object({
  text: z.string().max(200),
  url: z.string().max(2048),
});
export type UrlButton = z.infer<typeof buttonSchema>;

export const postContentSchema = z.object({
  text: z.string().max(20_000),
  entities: z.array(entitySchema).max(500),
  media: z.array(mediaItemSchema).max(20),
  buttons: z.array(z.array(buttonSchema).max(20)).max(20),
  disableLinkPreview: z.boolean(),
});
export type PostContent = z.infer<typeof postContentSchema>;

export const EMPTY_POST_CONTENT: PostContent = {
  text: '',
  entities: [],
  media: [],
  buttons: [],
  disableLinkPreview: false,
};

/** Сведения о медиафайле, нужные для проверки лимитов. */
export interface MediaInfo {
  kind: 'photo' | 'video';
  size: number;
}

export interface ContentProblem {
  /** Где проблема: text, media, buttons, entities. */
  field: 'text' | 'media' | 'buttons' | 'entities';
  message: string;
}

export const BUTTON_LIMITS = {
  textMaxLength: 64,
  perRowMax: 8,
  totalMax: 100,
} as const;

function isAllowedButtonUrl(url: string): boolean {
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url) || /^tg:\/\/[^\s]+$/i.test(url);
}

/**
 * Проверка публикации перед отправкой в Telegram. Возвращает список проблем на русском;
 * пустой список — публикация допустима. Значения лимитов — в TELEGRAM_LIMITS.
 */
export function validatePostContent(
  content: PostContent,
  media: ReadonlyMap<string, MediaInfo>,
): ContentProblem[] {
  const problems: ContentProblem[] = [];
  const hasMedia = content.media.length > 0;
  const textLength = content.text.length;

  if (!content.text.trim() && !hasMedia) {
    problems.push({ field: 'text', message: 'Добавьте текст или медиафайл' });
  }
  const textLimit = hasMedia
    ? TELEGRAM_LIMITS.captionMaxLength
    : TELEGRAM_LIMITS.messageTextMaxLength;
  if (textLength > textLimit) {
    problems.push({
      field: 'text',
      message: hasMedia
        ? `Подпись к медиа длиннее ${textLimit} символов (сейчас ${textLength})`
        : `Текст длиннее ${textLimit} символов (сейчас ${textLength})`,
    });
  }

  for (const e of content.entities) {
    if (e.offset + e.length > textLength) {
      problems.push({ field: 'entities', message: 'Форматирование выходит за пределы текста' });
      break;
    }
    if (e.type === 'text_link' && (!e.url || !isAllowedButtonUrl(e.url))) {
      problems.push({ field: 'entities', message: 'У ссылки в тексте неверный адрес' });
      break;
    }
  }

  if (content.media.length > TELEGRAM_LIMITS.mediaGroupMaxItems) {
    problems.push({
      field: 'media',
      message: `В одной публикации не больше ${TELEGRAM_LIMITS.mediaGroupMaxItems} медиафайлов`,
    });
  }
  const ids = new Set<string>();
  for (const item of content.media) {
    if (ids.has(item.assetId)) {
      problems.push({ field: 'media', message: 'Один и тот же файл добавлен дважды' });
      break;
    }
    ids.add(item.assetId);
    const info = media.get(item.assetId);
    if (!info) {
      problems.push({ field: 'media', message: 'Медиафайл не найден — загрузите его заново' });
      continue;
    }
    if (info.kind === 'photo' && info.size > TELEGRAM_LIMITS.photoUploadMaxBytes) {
      problems.push({ field: 'media', message: 'Фото больше 10 МБ — Telegram его не примет' });
    }
    if (info.kind === 'video' && info.size > TELEGRAM_LIMITS.fileUploadMaxBytes) {
      problems.push({ field: 'media', message: 'Видео больше 50 МБ — бот не может его загрузить' });
    }
  }

  const buttons = content.buttons.filter((row) => row.length > 0);
  const totalButtons = buttons.reduce((n, row) => n + row.length, 0);
  if (totalButtons > 0 && content.media.length > 1) {
    problems.push({
      field: 'buttons',
      message: 'К альбому из нескольких файлов нельзя добавить кнопки',
    });
  }
  if (totalButtons > BUTTON_LIMITS.totalMax) {
    problems.push({ field: 'buttons', message: `Не больше ${BUTTON_LIMITS.totalMax} кнопок` });
  }
  for (const row of buttons) {
    if (row.length > BUTTON_LIMITS.perRowMax) {
      problems.push({
        field: 'buttons',
        message: `В ряду не больше ${BUTTON_LIMITS.perRowMax} кнопок`,
      });
      break;
    }
  }
  for (const b of buttons.flat()) {
    if (!b.text.trim() || b.text.length > BUTTON_LIMITS.textMaxLength) {
      problems.push({
        field: 'buttons',
        message: `Текст кнопки — от 1 до ${BUTTON_LIMITS.textMaxLength} символов`,
      });
      break;
    }
    if (!isAllowedButtonUrl(b.url)) {
      problems.push({ field: 'buttons', message: `Неверная ссылка у кнопки «${b.text}»` });
      break;
    }
  }
  return problems;
}

/** Короткое описание для списков: первая строка текста или тип медиа. */
export function summarizeContent(content: PostContent, max = 80): string {
  const line = content.text.split('\n').find((l) => l.trim()) ?? '';
  if (line) return line.length > max ? `${line.slice(0, max - 1)}…` : line;
  if (content.media.length > 1) return `Альбом: ${content.media.length} файлов`;
  if (content.media.length === 1) return 'Медиафайл без подписи';
  return 'Пустой черновик';
}
