'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { confirmAction, haptic } from '@/shared/telegram';
import { Icon } from '@/shared/ui/icons';
import { btn, cardPad, inputCls, PageHeader, Pill } from '@/shared/ui/kit';

interface Status {
  status: 'disconnected' | 'active' | 'flood_wait' | 'error';
  connected: boolean;
  displayName: string | null;
  phoneMask: string | null;
  lastSyncAt: string | null;
  lastSyncCount: number | null;
  floodUntil: string | null;
  lastError: string | null;
  intervalMinutes: number;
  proxy: 'none' | 'socks' | 'unsupported';
}

type Step =
  | { kind: 'idle' }
  | { kind: 'code'; loginId: string }
  | { kind: 'password'; loginId: string; hint: string | null };

/**
 * Просмотры и пересылки через аккаунт владельца (MTProto, ADR-036): подключение по
 * коду из Telegram, состояние сбора, отключение. Пароль и код на сервере не хранятся.
 */
export function ViewsScreen() {
  const t = useTranslations('views');
  const format = useFormatter();
  const [st, setSt] = useState<Status | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState('+7');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Status>('/mtproto')
      .then((s) => !cancelled && setSt(s))
      .catch(() => !cancelled && setError(t('loadFailed')));
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('failed'));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const r = await run(() =>
      api.post<{ loginId: string }>('/mtproto/login', { apiId: Number(apiId), apiHash, phone }),
    );
    if (r) {
      setCode('');
      setStep({ kind: 'code', loginId: r.loginId });
    }
  }

  function done(s: Status) {
    haptic('success');
    setSt(s);
    setStep({ kind: 'idle' });
    setApiHash('');
    setPassword('');
    setNotice(t('connectedNotice'));
  }

  async function sendCode() {
    if (step.kind !== 'code') return;
    const r = await run(() =>
      api.post<({ next: 'done' } & Status) | { next: 'password'; hint: string | null }>(
        '/mtproto/login/code',
        { loginId: step.loginId, code },
      ),
    );
    if (!r) return;
    if (r.next === 'password') setStep({ kind: 'password', loginId: step.loginId, hint: r.hint });
    else done(r);
  }

  async function sendPassword() {
    if (step.kind !== 'password') return;
    const r = await run(() =>
      api.post<{ next: 'done' } & Status>('/mtproto/login/password', {
        loginId: step.loginId,
        password,
      }),
    );
    if (r) done(r);
  }

  async function cancel() {
    if (step.kind !== 'idle')
      await api.post('/mtproto/login/cancel', { loginId: step.loginId }).catch(() => undefined);
    setStep({ kind: 'idle' });
  }

  async function disconnect() {
    if (!(await confirmAction(t('confirmDisconnect')))) return;
    const r = await run(() => api.del<Status>('/mtproto'));
    if (r) setSt(r);
  }

  async function syncNow() {
    const r = await run(() => api.post('/mtproto/sync'));
    if (r !== undefined) setNotice(t('syncQueued'));
  }

  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('title')} back={{ href: '/more/', label: t('back') }} />
      <p className="max-w-prose text-sm text-text-muted">{t('intro')}</p>

      {error && (
        <p role="alert" className="rounded-[12px] bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <p className="rounded-[12px] bg-ok-soft px-3 py-2 text-sm text-ok">{notice}</p>}

      {st?.connected && (
        <section className={`${cardPad} flex flex-col gap-3`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-bold">{st.displayName}</p>
              <p className="text-sm text-text-faint">{st.phoneMask}</p>
            </div>
            <Pill
              tone={st.status === 'active' ? 'ok' : st.status === 'flood_wait' ? 'warn' : 'danger'}
            >
              {t(`status.${st.status}`)}
            </Pill>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-[12px] bg-surface-2 p-2.5">
              <dt className="text-[12px] text-text-faint">{t('lastSync')}</dt>
              <dd className="font-semibold">{st.lastSyncAt ? when(st.lastSyncAt) : t('never')}</dd>
            </div>
            <div className="rounded-[12px] bg-surface-2 p-2.5">
              <dt className="text-[12px] text-text-faint">{t('every')}</dt>
              <dd className="font-semibold">{t('minutes', { n: st.intervalMinutes })}</dd>
            </div>
          </dl>
          {st.status === 'flood_wait' && st.floodUntil && (
            <p className="text-sm text-warn">{t('floodUntil', { when: when(st.floodUntil) })}</p>
          )}
          {st.lastError && st.status !== 'flood_wait' && (
            <p className="text-sm text-warn">{st.lastError}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${btn.primary} text-sm`}
              disabled={busy}
              onClick={() => void syncNow()}
            >
              {t('syncNow')}
            </button>
            <button
              type="button"
              className={`${btn.danger} text-sm`}
              disabled={busy}
              onClick={() => void disconnect()}
            >
              {t('disconnect')}
            </button>
          </div>
        </section>
      )}

      {st && !st.connected && step.kind === 'idle' && (
        <>
          {st.status === 'error' && st.lastError && (
            <p className="rounded-[12px] bg-warn-soft px-3 py-2 text-sm text-warn">
              {st.lastError}
            </p>
          )}
          {st.proxy === 'unsupported' && (
            <p className="rounded-[12px] bg-warn-soft px-3 py-2 text-sm text-warn">
              {t('proxyUnsupported')}
            </p>
          )}
          <section className={`${cardPad} flex flex-col gap-2`}>
            <h2 className="text-[15px] font-bold">{t('how.title')}</h2>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text-muted">
              <li>
                {t('how.step1')}{' '}
                <a
                  href="https://my.telegram.org/apps"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={btn.link}
                >
                  my.telegram.org
                </a>
              </li>
              <li>{t('how.step2')}</li>
              <li>{t('how.step3')}</li>
            </ol>
          </section>
          <section className={`${cardPad} flex flex-col gap-3`}>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-text-muted">api_id</span>
              <input
                className={inputCls}
                inputMode="numeric"
                value={apiId}
                onChange={(e) => setApiId(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-text-muted">api_hash</span>
              <input
                className={inputCls}
                autoComplete="off"
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value.trim())}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-text-muted">{t('phone')}</span>
              <input
                className={inputCls}
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={`${btn.primary} self-start`}
              disabled={
                busy || !apiId || apiHash.length !== 32 || phone.replace(/\D/g, '').length < 10
              }
              onClick={() => void start()}
            >
              {busy ? t('sending') : t('getCode')}
            </button>
          </section>
          <section className="flex flex-col gap-1.5 rounded-[var(--radius-card)] bg-surface-2 p-4 text-[13px] text-text-muted">
            <p className="flex items-center gap-2 font-bold text-text">
              <Icon name="alert" size={16} />
              {t('risks.title')}
            </p>
            <p>{t('risks.access')}</p>
            <p>{t('risks.limits')}</p>
            <p>{t('risks.revoke')}</p>
          </section>
        </>
      )}

      {step.kind === 'code' && (
        <section className={`${cardPad} flex flex-col gap-3`}>
          <h2 className="text-[15px] font-bold">{t('codeTitle')}</h2>
          <p className="text-sm text-text-muted">{t('codeHint')}</p>
          <input
            className={`${inputCls} text-center text-xl tracking-[0.4em]`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={btn.primary}
              disabled={busy || code.length < 5}
              onClick={() => void sendCode()}
            >
              {busy ? t('checking') : t('confirm')}
            </button>
            <button
              type="button"
              className={btn.outline}
              disabled={busy}
              onClick={() => void cancel()}
            >
              {t('cancel')}
            </button>
          </div>
        </section>
      )}

      {step.kind === 'password' && (
        <section className={`${cardPad} flex flex-col gap-3`}>
          <h2 className="text-[15px] font-bold">{t('passwordTitle')}</h2>
          <p className="text-sm text-text-muted">
            {t('passwordHint')}
            {step.hint ? ` ${t('passwordHintValue', { hint: step.hint })}` : ''}
          </p>
          <input
            className={inputCls}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={btn.primary}
              disabled={busy || !password}
              onClick={() => void sendPassword()}
            >
              {busy ? t('checking') : t('confirm')}
            </button>
            <button
              type="button"
              className={btn.outline}
              disabled={busy}
              onClick={() => void cancel()}
            >
              {t('cancel')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
