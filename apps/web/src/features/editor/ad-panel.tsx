'use client';

import { AD_HASHTAG, hasAdHashtag } from '@author-studio/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Icon } from '@/shared/ui/icons';
import { btn } from '@/shared/ui/kit';

/**
 * Рекламный пост помечается хэштегом #реклама: при открытии он добавляется в конец
 * текста, если его нет. Без хэштега публикация сервером не пропускается.
 */
export function AdPanel({ text, onInsert }: { text: string; onInsert: (tag: string) => void }) {
  const t = useTranslations('editor.ad');
  const has = hasAdHashtag(text);
  const added = useRef(false);

  useEffect(() => {
    if (!added.current && !hasAdHashtag(text)) onInsert(AD_HASHTAG);
    added.current = true;
    // Только при первом показе панели: удалённый вручную хэштег не возвращаем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex items-center gap-3 rounded-[var(--radius-card)] border border-warn/40 bg-warn-soft/40 px-4 py-3">
      <Icon name="megaphone" className="shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-bold">{t('title')}</h2>
        <p className={`text-[13px] ${has ? 'text-ok' : 'text-text-muted'}`}>
          {has ? t('hasTag') : t('noTag')}
        </p>
      </div>
      {!has && (
        <button
          type="button"
          className={`${btn.outline} shrink-0 text-sm`}
          onClick={() => onInsert(AD_HASHTAG)}
        >
          {t('addTag')}
        </button>
      )}
    </section>
  );
}
