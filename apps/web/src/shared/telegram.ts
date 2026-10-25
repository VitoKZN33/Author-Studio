import { applyTheme, themeBackground } from './theme';

/**
 * Обвязка Telegram Mini Apps (официальный скрипт telegram-web-app.js).
 * initDataUnsafe используется только для отображения; доказательство подлинности —
 * строка initData, которую проверяет сервер.
 */
interface TelegramWebApp {
  initData: string;
  platform: string;
  version: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  isVersionAtLeast(version: string): boolean;
  showConfirm(message: string, callback: (ok: boolean) => void): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  onEvent?(event: 'themeChanged', handler: () => void): void;
  disableVerticalSwipes?(): void;
  HapticFeedback?: { notificationOccurred(type: 'error' | 'success' | 'warning'): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

/** initData или null, если страница открыта не из Telegram. */
export function getInitData(): string | null {
  const data = getWebApp()?.initData;
  return data ? data : null;
}

function syncTheme(app: TelegramWebApp): void {
  applyTheme(app.colorScheme === 'dark' ? 'dark' : 'light');
  if (app.isVersionAtLeast('6.1')) {
    const bg = themeBackground();
    if (bg) {
      app.setHeaderColor(bg);
      app.setBackgroundColor(bg);
    }
  }
}

export function prepareTelegramUi(): void {
  const app = getWebApp();
  if (!app) return;
  app.ready();
  app.expand();
  // Свайп вниз по содержимому не сворачивает приложение (Bot API 7.7+);
  // закрыть можно кнопкой или свайпом по шапке Telegram.
  if (app.isVersionAtLeast('7.7')) app.disableVerticalSwipes?.();
  syncTheme(app);
  // Пользователь сменил тему Telegram, не закрывая приложение.
  app.onEvent?.('themeChanged', () => syncTheme(app));
}

/** Подтверждение действия: нативный диалог Telegram, вне Telegram — браузерный. */
export function confirmAction(message: string): Promise<boolean> {
  const app = getWebApp();
  if (app?.isVersionAtLeast('6.2')) {
    return new Promise((resolve) => app.showConfirm(message, resolve));
  }
  return Promise.resolve(window.confirm(message));
}

export function haptic(type: 'error' | 'success' | 'warning'): void {
  try {
    getWebApp()?.HapticFeedback?.notificationOccurred(type);
  } catch {
    // Тактильный отклик необязателен.
  }
}

/** Подтверждение закрытия Mini App, пока есть несохранённые изменения. */
export function setClosingConfirmation(enabled: boolean): void {
  const app = getWebApp();
  if (!app?.isVersionAtLeast('6.2')) return;
  if (enabled) app.enableClosingConfirmation?.();
  else app.disableClosingConfirmation?.();
}
