'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';
import { Icon } from './icons';
import { Sheet } from './kit';

type Kind = 'regular' | 'ad';
const Ctx = createContext<{ open: () => void } | null>(null);

/**
 * «Новый пост»: сначала выбор — обычный или рекламный, затем черновик нужного типа
 * открывается в редакторе.
 */
export function NewPostProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('newPost');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(kind: Kind) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const post = await api.post<{ id: string }>('/posts', { kind });
      setOpen(false);
      router.push(`/posts/edit/?id=${post.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Ctx.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <Sheet open={open} onClose={() => setOpen(false)} title={t('title')}>
        <div className="flex flex-col gap-2.5 pb-2">
          {(['regular', 'ad'] as const).map((k) => (
            <button
              key={k}
              type="button"
              disabled={!!busy}
              onClick={() => void create(k)}
              className="flex items-center gap-3.5 rounded-[18px] border border-border bg-surface p-4 text-left active:scale-[0.99] disabled:opacity-60"
            >
              <span
                className={`grid size-12 shrink-0 place-items-center rounded-[14px] ${k === 'ad' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent'}`}
              >
                <Icon name={k === 'ad' ? 'megaphone' : 'edit'} size={24} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-bold">
                  {busy === k ? t('creating') : t(`${k}.title`)}
                </span>
                <span className="block text-[13px] leading-snug text-text-muted">
                  {t(`${k}.text`)}
                </span>
              </span>
              <Icon name="chevron" size={18} className="text-text-faint" />
            </button>
          ))}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </Sheet>
    </Ctx.Provider>
  );
}

export function useNewPost() {
  const ctx = useContext(Ctx);
  return { create: () => ctx?.open(), busy: false };
}
