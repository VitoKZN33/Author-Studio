'use client';

import type { PostContent } from '@author-studio/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { setClosingConfirmation } from '@/shared/telegram';
import type { PostView } from '../posts/types';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'error';

const DEBOUNCE_MS = 1200;
const RETRY_MS = 5000;
const backupKey = (id: string) => `author-studio:draft:${id}`;

interface Backup {
  baseVersion: number;
  content: PostContent;
  at: number;
}

function readBackup(id: string): Backup | null {
  try {
    const raw = localStorage.getItem(backupKey(id));
    return raw ? (JSON.parse(raw) as Backup) : null;
  } catch {
    return null;
  }
}

function writeBackup(id: string, b: Backup | null) {
  try {
    if (b) localStorage.setItem(backupKey(id), JSON.stringify(b));
    else localStorage.removeItem(backupKey(id));
  } catch {
    // Хранилище браузера недоступно — основная защита всё равно на сервере.
  }
}

/** Восстановление несохранённых правок из прошлой сессии (закрытие до сохранения). */
export function takeRestorableBackup(post: PostView): PostContent | null {
  const b = readBackup(post.id);
  if (!b) return null;
  if (b.baseVersion === post.version && JSON.stringify(b.content) !== JSON.stringify(post.content))
    return b.content;
  writeBackup(post.id, null);
  return null;
}

/**
 * Автосохранение черновика на сервере с защитой от затирания (версия) и от потери
 * правок: локальная копия до подтверждения сервером, повтор при обрыве связи,
 * подтверждение закрытия Mini App, пока есть несохранённое.
 */
export function useAutosave(postId: string, initialVersion: number) {
  const [state, setState] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState<PostView | null>(null);
  const version = useRef(initialVersion);
  const pending = useRef<PostContent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<PostView | null> | null>(null);
  const flushRef = useRef<(() => Promise<PostView | null>) | null>(null);

  const flush = useCallback(async (): Promise<PostView | null> => {
    if (inflight.current) await inflight.current;
    const content = pending.current;
    if (!content) return null;
    setState('saving');
    const run = (async () => {
      try {
        const saved = await api.put<PostView>(`/posts/${postId}`, {
          content,
          version: version.current,
        });
        version.current = saved.version;
        if (pending.current === content) {
          pending.current = null;
          writeBackup(postId, null);
          setState('saved');
        } else {
          setState('dirty');
        }
        return saved;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const current = (e.details as { current?: PostView } | undefined)?.current ?? null;
          setConflict(current);
          setState('conflict');
        } else if (e instanceof ApiError && e.status === 0) {
          setState('offline');
          timer.current = setTimeout(() => void flushRef.current?.(), RETRY_MS);
        } else {
          setState('error');
        }
        return null;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [postId]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const change = useCallback(
    (content: PostContent) => {
      pending.current = content;
      writeBackup(postId, { baseVersion: version.current, content, at: Date.now() });
      setState((s) => (s === 'conflict' ? s : 'dirty'));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush, postId],
  );

  /** Сохранить немедленно (перед публикацией). Возвращает актуальную версию. */
  const saveNow = useCallback(async (): Promise<number | null> => {
    if (timer.current) clearTimeout(timer.current);
    if (!pending.current) {
      if (inflight.current) await inflight.current;
      return state === 'conflict' ? null : version.current;
    }
    const saved = await flush();
    return saved ? saved.version : null;
  }, [flush, state]);

  /** Конфликт: принять версию сервера (свои правки отбрасываются). */
  const acceptServer = useCallback(() => {
    if (!conflict) return null;
    version.current = conflict.version;
    pending.current = null;
    writeBackup(postId, null);
    setConflict(null);
    setState('saved');
    return conflict;
  }, [conflict, postId]);

  /** Конфликт: оставить свою версию поверх серверной. */
  const keepMine = useCallback(() => {
    if (!conflict) return;
    version.current = conflict.version;
    setConflict(null);
    setState('dirty');
    void flush();
  }, [conflict, flush]);

  const unsaved =
    state === 'dirty' ||
    state === 'saving' ||
    state === 'offline' ||
    state === 'conflict' ||
    state === 'error';

  useEffect(() => {
    setClosingConfirmation(unsaved);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unsaved) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      setClosingConfirmation(false);
    },
    [],
  );

  // Сохранить при сворачивании Mini App / уходе со страницы.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && pending.current) void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flush]);

  return { state, change, saveNow, conflict, acceptServer, keepMine, version };
}
