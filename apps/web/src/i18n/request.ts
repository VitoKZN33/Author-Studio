import { getRequestConfig } from 'next-intl/server';

/** Основной язык — русский. Новые языки добавляются файлами в messages/. */
export const DEFAULT_LOCALE = 'ru';

export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  timeZone: 'Europe/Moscow',
  messages: (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default,
}));
