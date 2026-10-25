import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/features/session/session';
import { THEME_BOOT } from '@/shared/theme';
import './globals.css';

// Название продукта конфигурируется в настройках установки (APP_NAME).
export const metadata: Metadata = { title: 'Author Studio' };

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Без масштабирования: Mini App — приложение, а не страница (поля ввода ≥ 16 px).
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Тема до первой отрисовки — без вспышки светлого фона в тёмном Telegram. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        {/* Официальный скрипт Telegram Mini Apps: даёт window.Telegram.WebApp и initData. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <SessionProvider>{children}</SessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
