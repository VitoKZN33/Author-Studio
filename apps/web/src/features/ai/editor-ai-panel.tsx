'use client';

import { hasLossyEntities, toAiMarkup, type MessageEntity } from '@author-studio/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/shared/api';
import {
  TEXT_ACTIONS,
  TONES,
  aiReady,
  type TextAction,
  type TextVariant,
  type Tone,
} from './types';
import { Alert, errorText, input, primaryBtn, secondaryBtn } from './ui';
import { useAiSettings } from './use-ai-settings';

type Text = { text: string; entities: MessageEntity[] };

/**
 * AI в редакторе: результат всегда показывается как предложение. Текст поста
 * меняется только по кнопке владельца, и правку можно вернуть.
 */
export function EditorAiPanel({
  current,
  hasMedia,
  onApply,
}: {
  current: Text;
  hasMedia: boolean;
  onApply: (next: Text) => void;
}) {
  const t = useTranslations('ai.editor');
  const [open, setOpen] = useState(false);
  const { settings } = useAiSettings();
  const [action, setAction] = useState<TextAction>('shorten');
  const [tone, setTone] = useState<Tone>('friendly');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<TextVariant[] | null>(null);
  const [before, setBefore] = useState<Text | null>(null);

  const empty = !current.text.trim();
  const needsText = action !== 'write';

  async function run() {
    setBusy(true);
    setError(null);
    setVariants(null);
    try {
      const r = await api.post<{ variants: TextVariant[] }>('/ai/text', {
        action,
        text: toAiMarkup(current.text, current.entities),
        hasMedia,
        ...(action === 'write' ? { topic } : {}),
        ...(action === 'rewrite' ? { tone } : {}),
      });
      setVariants(r.variants);
    } catch (e) {
      setError(errorText(e, t('failed')));
    } finally {
      setBusy(false);
    }
  }

  function apply(v: TextVariant, mode: 'replace' | 'append' | 'title') {
    setBefore(current);
    if (mode === 'replace') onApply({ text: v.text, entities: v.entities });
    else if (mode === 'append') {
      const sep = current.text.trim() ? '\n\n' : '';
      const shift = current.text.length + sep.length;
      onApply({
        text: current.text + sep + v.text,
        entities: [
          ...current.entities,
          ...v.entities.map((e) => ({ ...e, offset: e.offset + shift })),
        ],
      });
    } else {
      const title = v.text.split('\n')[0]!.trim();
      const shift = title.length + 2;
      onApply({
        text: `${title}\n\n${current.text}`,
        entities: [
          { type: 'bold', offset: 0, length: title.length },
          ...current.entities.map((e) => ({ ...e, offset: e.offset + shift })),
        ],
      });
    }
    setVariants(null);
  }

  function undo() {
    if (!before) return;
    onApply(before);
    setBefore(null);
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between px-4 text-sm"
      >
        <span className="font-medium">{t('title')}</span>
        <span aria-hidden className="text-text-faint">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-4">
          {settings && !aiReady(settings) ? (
            <p className="text-sm text-text-muted">
              {settings.hasKey ? t('disabled') : t('notConfigured')}{' '}
              <Link href="/ai/?tab=settings" className="text-accent underline underline-offset-4">
                {t('toSettings')}
              </Link>
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('action')}>
                {TEXT_ACTIONS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={action === a}
                    onClick={() => setAction(a)}
                    className={`min-h-9 rounded-full border px-3 text-sm ${action === a ? 'border-accent bg-accent-soft text-accent' : 'border-border-strong text-text-muted'}`}
                  >
                    {t(`actions.${a}`)}
                  </button>
                ))}
              </div>
              {action === 'write' && (
                <textarea
                  className={`${input} min-h-20 py-2`}
                  maxLength={3000}
                  value={topic}
                  placeholder={t('topicPlaceholder')}
                  onChange={(e) => setTopic(e.target.value)}
                />
              )}
              {action === 'rewrite' && (
                <select
                  className={input}
                  value={tone}
                  onChange={(e) => setTone(e.target.value as Tone)}
                  aria-label={t('tone')}
                >
                  {TONES.map((x) => (
                    <option key={x} value={x}>
                      {t(`tones.${x}`)}
                    </option>
                  ))}
                </select>
              )}
              {needsText && empty && <p className="text-xs text-text-faint">{t('needText')}</p>}
              {needsText && !empty && hasLossyEntities(current.entities) && (
                <p className="text-xs text-warn">{t('lossy')}</p>
              )}
              <button
                type="button"
                className={`${primaryBtn} self-start`}
                disabled={busy || (needsText ? empty : !topic.trim())}
                onClick={() => void run()}
              >
                {busy ? t('thinking') : t('run')}
              </button>
              {error && <Alert>{error}</Alert>}
              {before && (
                <button
                  type="button"
                  onClick={undo}
                  className="self-start text-sm text-accent underline underline-offset-4"
                >
                  {t('undo')}
                </button>
              )}
              {variants?.map((v, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 p-3"
                >
                  <p className="text-sm whitespace-pre-wrap">{v.text}</p>
                  {v.tooLong && <p className="text-xs text-warn">{t('tooLong')}</p>}
                  <div className="flex flex-wrap gap-2">
                    {action === 'titles' ? (
                      <button
                        type="button"
                        className={secondaryBtn}
                        onClick={() => apply(v, 'title')}
                      >
                        {t('useTitle')}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={secondaryBtn}
                          onClick={() => apply(v, 'replace')}
                        >
                          {t('replace')}
                        </button>
                        <button
                          type="button"
                          className={secondaryBtn}
                          onClick={() => apply(v, 'append')}
                        >
                          {t('append')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              <p className="text-xs text-text-faint">{t('hint')}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
