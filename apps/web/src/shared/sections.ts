import type { IconName } from './ui/icons';

/** Разделы приложения и этап, на котором каждый появился (docs/ROADMAP.md). */
export const SECTIONS = [
  { key: 'overview', stage: 2, href: '/', icon: 'home' },
  { key: 'posts', stage: 4, href: '/posts/', icon: 'grid' },
  { key: 'calendar', stage: 4, href: '/calendar/', icon: 'calendar' },
  { key: 'analytics', stage: 5, href: '/analytics/', icon: 'chart' },
  { key: 'ai', stage: 7, href: '/ai/', icon: 'spark' },
  { key: 'channels', stage: 3, href: '/channels/', icon: 'channel' },
  { key: 'notifications', stage: 3, href: '/notifications/', icon: 'bell' },
  { key: 'views', stage: 7, href: '/views/', icon: 'eye' },
  { key: 'ads', stage: 6, href: '/ads/', icon: 'megaphone' },
  { key: 'settings', stage: 3, href: '/settings/', icon: 'settings' },
] as const satisfies readonly { key: string; stage: number; href: string; icon: IconName }[];

export type SectionKey = (typeof SECTIONS)[number]['key'] | 'more';

/** Последний завершённый этап: разделы более поздних этапов показываются неактивными. */
export const CURRENT_STAGE = 7;

/** Разделы, отложенные по решению владельца (docs/DECISIONS.md, ADR-032). */
export const POSTPONED_SECTIONS: readonly SectionKey[] = ['ads'];

/**
 * Нижняя панель на смартфоне: Главная, Посты, «+» (новый пост), Статистика, Ещё.
 * Календарь открывается из «Постов», остальные разделы — из «Ещё».
 */
export const TAB_OF: Record<SectionKey, 'overview' | 'posts' | 'analytics' | 'more'> = {
  overview: 'overview',
  posts: 'posts',
  calendar: 'posts',
  analytics: 'analytics',
  ai: 'more',
  channels: 'more',
  notifications: 'more',
  views: 'more',
  ads: 'more',
  settings: 'more',
  more: 'more',
};

/** Разделы на странице «Ещё». */
export const MORE_SECTIONS: readonly SectionKey[] = [
  'channels',
  'notifications',
  'views',
  'ai',
  'settings',
  'ads',
];
