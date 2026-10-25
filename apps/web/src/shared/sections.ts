/** Разделы приложения и этап, на котором каждый появится (docs/ROADMAP.md). */
export const SECTIONS = [
  { key: 'overview', stage: 2 },
  { key: 'posts', stage: 4 },
  { key: 'calendar', stage: 4 },
  { key: 'channels', stage: 3 },
  { key: 'ads', stage: 6 },
  { key: 'analytics', stage: 5 },
  { key: 'ai', stage: 7 },
  { key: 'settings', stage: 3 },
] as const;

export type SectionKey = (typeof SECTIONS)[number]['key'];
