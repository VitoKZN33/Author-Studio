import { describe, expect, it } from 'vitest';
import { aggregateReadiness } from './health';

describe('aggregateReadiness', () => {
  const now = new Date('2026-10-25T07:00:00.000Z');

  it('ok, когда все проверки прошли', () => {
    const r = aggregateReadiness({ db: { status: 'ok' }, redis: { status: 'ok' } }, now);
    expect(r.status).toBe('ok');
    expect(r.timestamp).toBe('2026-10-25T07:00:00.000Z');
  });

  it('fail, если хотя бы одна проверка не прошла', () => {
    const r = aggregateReadiness({ db: { status: 'ok' }, redis: { status: 'fail' } }, now);
    expect(r.status).toBe('fail');
  });

  it('пустой набор проверок считается готовым', () => {
    expect(aggregateReadiness({}, now).status).toBe('ok');
  });
});
