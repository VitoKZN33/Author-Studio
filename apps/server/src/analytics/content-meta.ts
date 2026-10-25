/**
 * Признаки поста для сравнения в статистике: тип контента, рубрики (хэштеги) и
 * рекламная маркировка. Вычисляются при записи поста, по полному тексту.
 */

export type ContentKind = 'text' | 'photo' | 'video' | 'album' | 'document' | 'other';

const HASHTAG_RE = /(?<![\p{L}\p{N}_/&=?#])#([\p{L}\p{N}_]{2,64})/gu;

export function hashtagsOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(HASHTAG_RE)) out.add(m[1]!.toLowerCase());
  return [...out].slice(0, 20);
}

/** Реклама: токен erid, строка «Реклама…» или хэштег #реклама / #ad. */
export function isAdText(text: string, tags: string[] = hashtagsOf(text)): boolean {
  return (
    /\berid[\s:=]/i.test(text) ||
    /(^|\n)\s*реклама(?![\p{L}\p{N}])/iu.test(text) ||
    tags.includes('реклама') ||
    tags.includes('ad')
  );
}

export function contentMeta(
  text: string,
  media: { photos: number; videos: number; documents?: number; other?: number },
) {
  const total = media.photos + media.videos + (media.documents ?? 0) + (media.other ?? 0);
  const kind: ContentKind =
    total > 1
      ? 'album'
      : media.photos === 1
        ? 'photo'
        : media.videos === 1
          ? 'video'
          : (media.documents ?? 0) === 1
            ? 'document'
            : (media.other ?? 0) > 0
              ? 'other'
              : 'text';
  const hashtags = hashtagsOf(text);
  return { contentKind: kind, hashtags, isAd: isAdText(text, hashtags) };
}
