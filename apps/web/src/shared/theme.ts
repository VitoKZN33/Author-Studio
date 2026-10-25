/**
 * Тема интерфейса следует теме Telegram: светлая или тёмная. Скрипт THEME_BOOT
 * выполняется до первой отрисовки (layout.tsx) и читает параметры запуска Mini App
 * из адреса, поэтому тёмная тема не «мигает» светлой.
 */
export const THEME_BOOT = `(function(){try{var d='light';var h=location.hash||'';var m=/tgWebAppThemeParams=([^&]+)/.exec(h);if(m){var p=JSON.parse(decodeURIComponent(m[1]));var c=(p.bg_color||'').replace('#','');if(c.length===6){var r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);d=(0.299*r+0.587*g+0.114*b)<128?'dark':'light';}}else if(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches){d='dark';}document.documentElement.dataset.theme=d;}catch(e){}})();`;

export type Theme = 'light' | 'dark';

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Цвет фона текущей темы — для шапки и фона Telegram. */
export function themeBackground(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
}
