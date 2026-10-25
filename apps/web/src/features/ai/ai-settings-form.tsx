'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/shared/api';
import { haptic } from '@/shared/telegram';
import { PROVIDER_PRESETS, type AiSettings, type AiUsage } from './types';
import { Alert, card, errorText, Field, input, primaryBtn, secondaryBtn } from './ui';

type Draft = Omit<
  AiSettings,
  'hasKey' | 'keyMask' | 'proxyAvailable' | 'status' | 'lastCheckAt' | 'lastError'
>;

const toDraft = (s: AiSettings): Draft => ({
  enabled: s.enabled,
  baseUrl: s.baseUrl,
  model: s.model,
  useProxy: s.useProxy,
  styleGuide: s.styleGuide,
  timeoutSeconds: s.timeoutSeconds,
  maxOutputTokens: s.maxOutputTokens,
  dailyRequestLimit: s.dailyRequestLimit,
  monthlyTokenLimit: s.monthlyTokenLimit,
  priceInputPerMillion: s.priceInputPerMillion,
  priceOutputPerMillion: s.priceOutputPerMillion,
});

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

export function AiSettingsForm({
  settings,
  onSaved,
}: {
  settings: AiSettings;
  onSaved: (s: AiSettings) => void;
}) {
  const t = useTranslations('ai.settings');
  const format = useFormatter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [usageTick, setUsageTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AiUsage>('/ai/usage')
      .then((u) => !cancelled && setUsage(u))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [usageTick]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const preset = PROVIDER_PRESETS.find((p) => p.baseUrl === draft.baseUrl)?.key ?? 'custom';

  async function save(): Promise<boolean> {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { ...draft };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const s = await api.put<AiSettings>('/ai/settings', body);
      onSaved(s);
      setApiKey('');
      setNotice(t('saved'));
      return true;
    } catch (e) {
      setError(errorText(e, t('saveFailed')));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function removeKey() {
    setBusy('save');
    try {
      onSaved(await api.put<AiSettings>('/ai/settings', { apiKey: '' }));
    } catch (e) {
      setError(errorText(e, t('saveFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    if (!(await save())) return;
    setBusy('test');
    setError(null);
    setNotice(null);
    try {
      const r = await api.post<{ ms: number; reply: string }>('/ai/test');
      haptic('success');
      setNotice(t('testOk', { ms: r.ms, reply: r.reply }));
    } catch (e) {
      haptic('error');
      setError(errorText(e, t('testFailed')));
    } finally {
      onSaved(await api.get<AiSettings>('/ai/settings'));
      setUsageTick((n) => n + 1);
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-bold">{t('connection')}</h2>
          <StatusTag status={settings.status} />
        </div>
        {settings.lastError && settings.status === 'error' && <Alert>{settings.lastError}</Alert>}

        <Field label={t('provider')}>
          <select
            className={input}
            value={preset}
            onChange={(e) => {
              const p = PROVIDER_PRESETS.find((x) => x.key === e.target.value);
              if (p) setDraft((d) => ({ ...d, baseUrl: p.baseUrl, model: p.model || d.model }));
            }}
          >
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {t(`presets.${p.key}`)}
              </option>
            ))}
            <option value="custom">{t('presets.custom')}</option>
          </select>
        </Field>
        <Field label={t('baseUrl')} hint={t('baseUrlHint')}>
          <input
            className={input}
            value={draft.baseUrl}
            inputMode="url"
            autoComplete="off"
            onChange={(e) => set('baseUrl', e.target.value)}
          />
        </Field>
        <Field label={t('model')} hint={t('modelHint')}>
          <input
            className={input}
            value={draft.model}
            autoComplete="off"
            onChange={(e) => set('model', e.target.value)}
          />
        </Field>
        <Field
          label={t('apiKey')}
          hint={
            settings.hasKey ? t('apiKeySaved', { mask: settings.keyMask ?? '' }) : t('apiKeyHint')
          }
        >
          <input
            className={input}
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder={settings.hasKey ? (settings.keyMask ?? '') : 'sk-…'}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>
        {settings.hasKey && (
          <button
            type="button"
            onClick={() => void removeKey()}
            className="self-start text-xs text-danger underline underline-offset-4"
          >
            {t('removeKey')}
          </button>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--color-accent)]"
            checked={draft.useProxy}
            disabled={!settings.proxyAvailable}
            onChange={(e) => set('useProxy', e.target.checked)}
          />
          <span>
            {t('useProxy')}
            <span className="block text-xs text-text-faint">
              {settings.proxyAvailable ? t('useProxyHint') : t('noProxy')}
            </span>
          </span>
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            {t('enabled')}
            <span className="block text-xs text-text-faint">{t('enabledHint')}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="size-5 shrink-0 accent-[var(--color-accent)]"
            checked={draft.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
        </label>
      </section>

      <section className={card}>
        <h2 className="text-[15px] font-bold">{t('style')}</h2>
        <textarea
          className={`${input} min-h-28 py-2`}
          maxLength={3000}
          value={draft.styleGuide}
          placeholder={t('stylePlaceholder')}
          onChange={(e) => set('styleGuide', e.target.value)}
        />
        <p className="text-xs text-text-faint">{t('styleHint')}</p>
      </section>

      <section className={card}>
        <h2 className="text-[15px] font-bold">{t('limits')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('dailyRequestLimit')}>
            <input
              className={input}
              type="number"
              min={1}
              value={draft.dailyRequestLimit}
              onChange={(e) => set('dailyRequestLimit', Number(e.target.value))}
            />
          </Field>
          <Field label={t('monthlyTokenLimit')} hint={t('emptyNoLimit')}>
            <input
              className={input}
              type="number"
              min={1000}
              value={draft.monthlyTokenLimit ?? ''}
              onChange={(e) => set('monthlyTokenLimit', numOrNull(e.target.value))}
            />
          </Field>
          <Field label={t('maxOutputTokens')}>
            <input
              className={input}
              type="number"
              min={100}
              value={draft.maxOutputTokens}
              onChange={(e) => set('maxOutputTokens', Number(e.target.value))}
            />
          </Field>
          <Field label={t('timeoutSeconds')}>
            <input
              className={input}
              type="number"
              min={10}
              max={300}
              value={draft.timeoutSeconds}
              onChange={(e) => set('timeoutSeconds', Number(e.target.value))}
            />
          </Field>
          <Field label={t('priceInput')} hint={t('priceHint')}>
            <input
              className={input}
              type="number"
              min={0}
              value={draft.priceInputPerMillion ?? ''}
              onChange={(e) => set('priceInputPerMillion', numOrNull(e.target.value))}
            />
          </Field>
          <Field label={t('priceOutput')}>
            <input
              className={input}
              type="number"
              min={0}
              value={draft.priceOutputPerMillion ?? ''}
              onChange={(e) => set('priceOutputPerMillion', numOrNull(e.target.value))}
            />
          </Field>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} disabled={!!busy} onClick={() => void save()}>
          {busy === 'save' ? t('saving') : t('save')}
        </button>
        <button
          type="button"
          className={secondaryBtn}
          disabled={!!busy || (!settings.hasKey && !apiKey.trim())}
          onClick={() => void test()}
        >
          {busy === 'test' ? t('testing') : t('test')}
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && <p className="text-sm text-ok">{notice}</p>}

      {usage && (
        <section className={card}>
          <h2 className="text-[15px] font-bold">{t('usage.title')}</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-text-muted">{t('usage.today')}</dt>
            <dd className="text-right tabular-nums">
              {usage.today.requests} / {usage.today.limit}
            </dd>
            <dt className="text-text-muted">{t('usage.monthRequests')}</dt>
            <dd className="text-right tabular-nums">
              {usage.month.requests}
              {usage.month.errors > 0 && ` (${t('usage.errors', { n: usage.month.errors })})`}
            </dd>
            <dt className="text-text-muted">{t('usage.monthTokens')}</dt>
            <dd className="text-right tabular-nums">
              {format.number(usage.month.tokens)}
              {usage.month.tokenLimit !== null && ` / ${format.number(usage.month.tokenLimit)}`}
            </dd>
            <dt className="text-text-muted">{t('usage.cost')}</dt>
            <dd className="text-right tabular-nums">
              {usage.month.estimatedCostRub !== null
                ? `≈ ${format.number(usage.month.estimatedCostRub)} ₽`
                : t('usage.noPrices')}
            </dd>
          </dl>
          <p className="text-xs text-text-faint">{t('usage.note')}</p>
        </section>
      )}

      <p className="max-w-prose text-xs leading-relaxed text-text-faint">{t('privacy')}</p>
    </div>
  );
}

function StatusTag({ status }: { status: AiSettings['status'] }) {
  const t = useTranslations('ai.status');
  const tone = {
    ok: 'border-ok/40 text-ok',
    error: 'border-danger/40 text-danger',
    unchecked: 'border-warn/40 text-warn',
    not_configured: 'border-border text-text-faint',
  }[status];
  return <span className={`rounded border px-1.5 py-px text-[11px] ${tone}`}>{t(status)}</span>;
}
