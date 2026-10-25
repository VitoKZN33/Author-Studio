/**
 * Рекламный пост помечается хэштегом #реклама (решение владельца, ADR-039).
 * Поля рекламодателя, ИНН и ERID в интерфейсе не используются; тип сохранён для
 * совместимости с уже сохранёнными постами. Соответствие закону приложение не проверяет.
 */
export interface AdInfo {
  advertiser?: string;
  inn?: string;
  erid?: string;
  noErid?: boolean;
}

export type AdMarkingItem = 'label';

export const AD_HASHTAG = '#реклама';

export const AD_MARKING_LABELS: Record<AdMarkingItem, string> = {
  label: 'хэштег #реклама',
};

const AD_TAG_RE = /(?<![\p{L}\p{N}_/&=?#])#реклама(?![\p{L}\p{N}_])/iu;

export function hasAdHashtag(text: string): boolean {
  return AD_TAG_RE.test(text);
}

export function adMarkingMissing(text: string, _ad?: AdInfo): AdMarkingItem[] {
  return hasAdHashtag(text) ? [] : ['label'];
}
