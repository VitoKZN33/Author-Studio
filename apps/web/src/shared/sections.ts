/** Разделы приложения и этап, на котором каждый появится (docs/ROADMAP.md). */
export const SECTIONS = [
  { key: 'overview', stage: 2, href: '/' },
  { key: 'posts', stage: 4, href: '/posts/' },
  { key: 'calendar', stage: 4, href: '/calendar/' },
  { key: 'channels', stage: 3, href: '/channels/' },
  { key: 'ads', stage: 6, href: '/ads/' },
  { key: 'analytics', stage: 5, href: '/analytics/' },
  { key: 'ai', stage: 7, href: '/ai/' },
  { key: 'settings', stage: 3, href: '/settings/' },
] as const;

export type SectionKey = (typeof SECTIONS)[number]['key'];

/** Последний завершённый этап: разделы более поздних этапов показываются неактивными. */
export const CURRENT_STAGE = 7;

/** Разделы, отложенные по решению владельца (docs/DECISIONS.md, ADR-032). */
export const POSTPONED_SECTIONS: readonly SectionKey[] = ['ads'];

/** Разделы нижней панели на смартфоне (не больше пяти). */
export const MOBILE_TABS: readonly SectionKey[] = [
  'overview',
  'posts',
  'calendar',
  'analytics',
  'settings',
];
