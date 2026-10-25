/**
 * Маркировка рекламы в тексте поста (ФЗ «О рекламе», ст. 18.1): пометка «Реклама»,
 * сведения о рекламодателе и токен erid. Проверка формальная — юридическую
 * достаточность приложение не гарантирует.
 */
export interface AdInfo {
  advertiser?: string;
  inn?: string;
  erid?: string;
  /** Маркировка не требуется (например, бесплатный взаимопиар) — решение владельца. */
  noErid?: boolean;
}

export type AdMarkingItem = 'label' | 'erid' | 'advertiser';

export const AD_MARKING_LABELS: Record<AdMarkingItem, string> = {
  label: 'пометка «Реклама»',
  erid: 'токен erid',
  advertiser: 'сведения о рекламодателе',
};

export function adMarkingMissing(text: string, ad: AdInfo): AdMarkingItem[] {
  if (ad.noErid) return [];
  const out: AdMarkingItem[] = [];
  if (!/реклама/i.test(text)) out.push('label');
  if (!/erid/i.test(text)) out.push('erid');
  const name = ad.advertiser?.trim().toLowerCase().slice(0, 20);
  if (name && !text.toLowerCase().includes(name)) out.push('advertiser');
  return out;
}

/** Строка маркировки для начала поста. */
export function adMarkingLine(ad: AdInfo): string {
  const who = [ad.advertiser?.trim(), ad.inn?.trim() ? `ИНН ${ad.inn.trim()}` : '']
    .filter(Boolean)
    .join(', ');
  const parts = [`Реклама${who ? `. ${who}` : ''}`];
  if (ad.erid?.trim()) parts.push(`erid: ${ad.erid.trim()}`);
  return parts.join('. ');
}
