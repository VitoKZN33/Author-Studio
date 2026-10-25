'use client';

import { hasLossyEntities, toAiMarkup, type MessageEntity } from '@author-studio/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/shared/api';
import { Icon } from '@/shared/ui/icons';
import { btn, inputCls } from '@/shared/ui/kit';
import { TONES, aiReady, type TextAction, type TextVariant, type Tone } from './types';
import { Alert, errorText } from './ui';
import { useAiSettings } from './use-ai-settings';

type Text = { text: string; entities: MessageEntity[] };

/** Действия в строке под редактором; «Написать» и «Тон» сначала спрашивают параметры. */
const CHIPS: TextAction[] = ['shorten', 'fix', 'titles', 'rewrite', 'variants', 'write'];

/**
 * AI в редакторе: строка быстрых действий. Результат — карточка-предложение;
 * текст поста меняется только по кнопке, и правку можно вернуть.
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
  const { settings } = useAiSettings();
  const [pending, setPending] = useState<'write' | 'rewrite' | null>(null);
  const [tone, setTone] = useState<Tone>('friendly');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState<TextAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ action: TextAction; variants: TextVariant[] } | null>(
    null,
  );
  const [before, setBefore] = useState<Text | null>(null);

  const empty = !current.text.trim();
  const ready = aiReady(settings);

  async function run(action: TextAction, extra: { topic?: string; tone?: Tone } = {}) {
    setBusy(action);
    setError(null);
    setResult(null);
    try {
      const r = await api.post<{ variants: TextVariant[] }>('/ai/text', {
        action,
        text: toAiMarkup(current.text, current.entities),
        hasMedia,
        ...extra,
      });
      setResult({ action, variants: r.variants });
      setPending(null);
    } catch (e) {
      setError(errorText(e, t('failed')));
    } finally {
      setBusy(null);
    }
  }

  function onChip(a: TextAction) {
    setError(null);
    if (a === 'write' || a === 'rewrite') {
      setPending((p) => (p === a ? null : a));
      return;
    }
    void run(a);
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
    setResult(null);
  }

  if (settings && !ready) {
    return (
      <Link
        href="/ai/?tab=settings"
        className="flex items-center gap-2 rounded-full border border-dashed border-border-strong px-3.5 py-2 text-sm text-text-muted"
      >
        <Icon name="spark" size={18} className="text-accent" />
        {settings.hasKey ? t('disabled') : t('notConfigured')}
        <span className="ml-auto font-semibold text-accent">{t('toSettings')}</span>
      </Link>
    );
  }

  return (
    <section className="flex flex-col gap-2.5" aria-label={t('title')}>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 text-sm font-bold text-on-ink">
          <Icon name="spark" size={16} />
          AI
        </span>
        {CHIPS.map((a) => {
          const needsText = a !== 'write';
          return (
            <button
              key={a}
              type="button"
              disabled={!!busy || (needsText && empty)}
              aria-pressed={pending === a}
              onClick={() => onChip(a)}
              className={`min-h-9 shrink-0 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap disabled:opacity-45 ${
                pending === a
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-surface text-text'
              }`}
            >
              {busy === a ? t('thinking') : t(`actions.${a}`)}
            </button>
          );
        })}
      </div>

      {empty && !pending && <p className="text-xs text-text-faint">{t('needText')}</p>}
      {!empty && hasLossyEntities(current.entities) && (
        <p className="text-xs text-warn">{t('lossy')}</p>
      )}

      {pending === 'write' && (
        <div className="flex flex-col gap-2">
          <textarea
            className={`${inputCls} min-h-20 py-2`}
            maxLength={3000}
            value={topic}
            placeholder={t('topicPlaceholder')}
            onChange={(e) => setTopic(e.target.value)}
          />
          <button
            type="button"
            className={`${btn.primary} self-start`}
            disabled={!!busy || !topic.trim()}
            onClick={() => void run('write', { topic })}
          >
            {busy ? t('thinking') : t('run')}
          </button>
        </div>
      )}
      {pending === 'rewrite' && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('tone')}>
          {TONES.map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={tone === x}
              disabled={!!busy}
              onClick={() => {
                setTone(x);
                void run('rewrite', { tone: x });
              }}
              className="min-h-9 rounded-full border border-border bg-surface px-3 text-sm"
            >
              {t(`tones.${x}`)}
            </button>
          ))}
        </div>
      )}

      {error && <Alert>{error}</Alert>}
      {before && (
        <button
          type="button"
          onClick={() => {
            onApply(before);
            setBefore(null);
          }}
          className="self-start text-sm font-semibold text-accent"
        >
          {t('undo')}
        </button>
      )}

      {result?.variants.map((v, i) => (
        <div
          key={i}
          className="flex flex-col gap-2.5 rounded-[16px] border border-accent/40 bg-accent-soft p-3"
        >
          <p className="text-[15px] whitespace-pre-wrap">{v.text}</p>
          {v.tooLong && <p className="text-xs text-warn">{t('tooLong')}</p>}
          <div className="flex flex-wrap gap-2">
            {result.action === 'titles' ? (
              <button
                type="button"
                className={`${btn.primary} min-h-9 text-sm`}
                onClick={() => apply(v, 'title')}
              >
                {t('useTitle')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`${btn.primary} min-h-9 text-sm`}
                  onClick={() => apply(v, 'replace')}
                >
                  {t('replace')}
                </button>
                <button
                  type="button"
                  className={`${btn.outline} min-h-9 text-sm`}
                  onClick={() => apply(v, 'append')}
                >
                  {t('append')}
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      {result && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-faint">{t('hint')}</p>
          <button type="button" className="text-sm text-text-muted" onClick={() => setResult(null)}>
            {t('dismiss')}
          </button>
        </div>
      )}
    </section>
  );
}
