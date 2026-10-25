import { describe, expect, it } from 'vitest';
import { InitDataError, validateInitData } from './init-data.js';
import { initDataFor, signInitData } from './init-data.test-helpers.js';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const NOW = new Date('2026-10-25T08:00:00Z');
const opts = { maxAgeSeconds: 3600, now: NOW };

function reason(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof InitDataError) return e.reason;
    throw e;
  }
  return undefined;
}

describe('validateInitData', () => {
  it('принимает корректно подписанные данные', () => {
    const raw = initDataFor(42, TOKEN, {
      authDate: new Date(NOW.getTime() - 60_000),
      extra: { start_param: 'channels' },
    });
    const r = validateInitData(raw, TOKEN, opts);
    expect(r.user.id).toBe(42);
    expect(r.startParam).toBe('channels');
  });

  it('учитывает поле signature в строке проверки (как Telegram)', () => {
    const raw = signInitData(
      {
        user: JSON.stringify({ id: 7, first_name: 'A' }),
        auth_date: String(NOW.getTime() / 1000),
        signature: 'c2lnbmF0dXJl',
      },
      TOKEN,
    );
    expect(validateInitData(raw, TOKEN, opts).user.id).toBe(7);
  });

  it('отклоняет подмену поля user', () => {
    const raw = initDataFor(42, TOKEN, { authDate: NOW });
    const forged = raw.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(forged).not.toBe(raw);
    expect(reason(() => validateInitData(forged, TOKEN, opts))).toBe('bad_signature');
  });

  it('отклоняет подпись другим токеном бота', () => {
    const raw = initDataFor(42, '987654321:ZZHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', { authDate: NOW });
    expect(reason(() => validateInitData(raw, TOKEN, opts))).toBe('bad_signature');
  });

  it('отклоняет просроченные данные', () => {
    const raw = initDataFor(42, TOKEN, { authDate: new Date(NOW.getTime() - 3601_000) });
    expect(reason(() => validateInitData(raw, TOKEN, opts))).toBe('expired');
  });

  it('отклоняет данные «из будущего» сверх допуска', () => {
    const raw = initDataFor(42, TOKEN, { authDate: new Date(NOW.getTime() + 120_000) });
    expect(reason(() => validateInitData(raw, TOKEN, opts))).toBe('future');
  });

  it('отклоняет отсутствие hash, пустую строку и повторяющиеся ключи', () => {
    expect(reason(() => validateInitData('', TOKEN, opts))).toBe('missing');
    expect(reason(() => validateInitData('auth_date=1&user=%7B%7D', TOKEN, opts))).toBe(
      'malformed',
    );
    const raw = initDataFor(42, TOKEN, { authDate: NOW });
    expect(reason(() => validateInitData(`${raw}&auth_date=1`, TOKEN, opts))).toBe('malformed');
  });

  it('отклоняет данные без пользователя', () => {
    const raw = signInitData({ auth_date: String(NOW.getTime() / 1000) }, TOKEN);
    expect(reason(() => validateInitData(raw, TOKEN, opts))).toBe('no_user');
  });

  it('отклоняет слишком длинную строку', () => {
    expect(reason(() => validateInitData('a'.repeat(9000), TOKEN, opts))).toBe('malformed');
  });
});
