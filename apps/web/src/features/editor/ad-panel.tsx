'use client';

import { adMarkingLine, adMarkingMissing, type AdInfo } from '@author-studio/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { Icon } from '@/shared/ui/icons';
import { btn, inputCls } from '@/shared/ui/kit';

/**
 * Маркировка рекламного поста: рекламодатель, ИНН, ERID и вставка строки «Реклама…»
 * в начало текста. Сохраняется сразу; публикация без маркировки сервером не пропускается.
 */
export function AdPanel({
  postId,
  initial,
  text,
  onInsert,
  onChange,
}: {
  postId: string;
  initial: AdInfo | null;
  text: string;
  onInsert: (line: string) => void;
  onChange: (ad: AdInfo) => void;
}) {
  const t = useTranslations('editor.ad');
  const [ad, setAd] = useState<AdInfo>(initial ?? {});
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function change(patch: Partial<AdInfo>) {
    const next = { ...ad, ...patch };
    setAd(next);
    onChange(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setError(null);
      api
        .put(`/posts/${postId}/ad`, next)
        .catch((e: unknown) => setError(e instanceof ApiError ? e.message : t('failed')));
    }, 600);
  }

  const missing = adMarkingMissing(text, ad);
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-warn/40 bg-warn-soft/40 p-4">
      <div className="flex items-center gap-2">
        <Icon name="megaphone" className="text-warn" />
        <h2 className="text-[15px] font-bold">{t('title')}</h2>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <input
          className={inputCls}
          placeholder={t('advertiser')}
          value={ad.advertiser ?? ''}
          maxLength={300}
          onChange={(e) => change({ advertiser: e.target.value })}
        />
        <input
          className={inputCls}
          placeholder={t('inn')}
          inputMode="numeric"
          value={ad.inn ?? ''}
          maxLength={12}
          onChange={(e) => change({ inn: e.target.value.replace(/\D/g, '') })}
        />
        <input
          className={`${inputCls} sm:col-span-2`}
          placeholder={t('erid')}
          value={ad.erid ?? ''}
          maxLength={100}
          disabled={ad.noErid}
          onChange={(e) => change({ erid: e.target.value.trim() })}
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--color-accent)]"
          checked={!!ad.noErid}
          onChange={(e) => change({ noErid: e.target.checked })}
        />
        <span>
          {t('noErid')}
          <span className="block text-xs text-text-faint">{t('noEridHint')}</span>
        </span>
      </label>
      {!ad.noErid && (
        <>
          <button
            type="button"
            className={`${btn.outline} self-start text-sm`}
            disabled={!ad.advertiser?.trim() && !ad.erid?.trim()}
            onClick={() => onInsert(adMarkingLine(ad))}
          >
            {t('insert')}
          </button>
          <ul className="flex flex-col gap-1 text-[13px]">
            {(['label', 'advertiser', 'erid'] as const).map((k) => {
              const ok = !missing.includes(k) && (k !== 'advertiser' || !!ad.advertiser?.trim());
              return (
                <li
                  key={k}
                  className={`flex items-center gap-1.5 ${ok ? 'text-ok' : 'text-text-muted'}`}
                >
                  <Icon name={ok ? 'check' : 'close'} size={15} strokeWidth={2.4} />
                  {t(`check.${k}`)}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-text-faint">{t('hint')}</p>
        </>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}
