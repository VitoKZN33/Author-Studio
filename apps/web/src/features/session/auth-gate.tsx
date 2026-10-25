'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useSession } from './session';

/** Показывает содержимое только после входа; иначе — понятный экран состояния. */
export function AuthGate({ children }: { children: ReactNode }) {
  const t = useTranslations('session');
  const { state, retry } = useSession();

  if (state.kind === 'ready') return <>{children}</>;

  let title: string;
  let text: string;
  let action: ReactNode = null;
  switch (state.kind) {
    case 'starting':
      return (
        <div className="grid min-h-[60dvh] place-items-center" aria-busy="true">
          <p className="text-sm text-text-muted">{t('starting')}</p>
        </div>
      );
    case 'outside-telegram':
      title = t('outsideTitle');
      text = t('outsideText');
      break;
    case 'denied':
      title = t('deniedTitle');
      text = state.message;
      break;
    case 'signed-out':
      title = t('signedOutTitle');
      text = t('signedOutText');
      action = <PrimaryButton onClick={retry}>{t('signIn')}</PrimaryButton>;
      break;
    case 'error':
      title = t('errorTitle');
      text = state.message;
      action = <PrimaryButton onClick={retry}>{t('retry')}</PrimaryButton>;
      break;
  }

  return (
    <div className="grid min-h-[60dvh] place-items-center px-2">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{text}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 rounded-[var(--radius-control)] bg-accent px-5 text-sm font-medium text-on-accent hover:brightness-110"
    >
      {children}
    </button>
  );
}
