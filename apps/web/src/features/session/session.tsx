'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, setSessionToken, setUnauthorizedHandler } from '@/shared/api';
import { getInitData, prepareTelegramUi } from '@/shared/telegram';

export interface SessionUser {
  id: string;
  telegramId: string;
  role: 'owner';
  firstName: string;
}

interface LoginResponse {
  token: string;
  expiresAt: string;
  user: SessionUser;
  startParam: string | null;
}

export type SessionState =
  | { kind: 'starting' }
  | { kind: 'outside-telegram' }
  | { kind: 'denied'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'signed-out' }
  | { kind: 'ready'; user: SessionUser; expiresAt: string };

interface SessionContextValue {
  state: SessionState;
  retry: () => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Разделы, на которые можно попасть по startapp-параметру ссылки на Mini App. */
const START_ROUTES: Record<string, string> = { channels: '/channels/', settings: '/settings/' };

async function login(): Promise<LoginResponse | SessionState> {
  const initData = getInitData();
  if (!initData) return { kind: 'outside-telegram' };
  try {
    return await api.post<LoginResponse>('/auth/telegram', { initData });
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return { kind: 'denied', message: e.message };
    return { kind: 'error', message: e instanceof Error ? e.message : 'Не удалось войти' };
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const startHandled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    prepareTelegramUi();
    void login().then((r) => {
      if (cancelled) return;
      if ('token' in r) {
        setSessionToken(r.token);
        setState({ kind: 'ready', user: r.user, expiresAt: r.expiresAt });
        const target = r.startParam ? START_ROUTES[r.startParam] : undefined;
        if (target && !startHandled.current && pathname === '/') {
          startHandled.current = true;
          router.replace(target);
        }
      } else {
        setState(r);
      }
    });
    return () => {
      cancelled = true;
    };
    // Вход выполняется при запуске и по кнопке «Повторить», а не при смене страницы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Истёкшая сессия: тихий повторный вход по initData (если они ещё действительны).
  useEffect(() => {
    setUnauthorizedHandler(async () => {
      const r = await login();
      if ('token' in r) {
        setSessionToken(r.token);
        return true;
      }
      setSessionToken(null);
      setState(
        r.kind === 'error'
          ? {
              kind: 'error',
              message: 'Сессия истекла. Закройте и снова откройте приложение в Telegram.',
            }
          : r,
      );
      return false;
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const retry = useCallback(() => {
    setState({ kind: 'starting' });
    setAttempt((n) => n + 1);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setSessionToken(null);
    setState({ kind: 'signed-out' });
  }, []);

  const value = useMemo(() => ({ state, retry, logout }), [state, retry, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession вне SessionProvider');
  return ctx;
}
