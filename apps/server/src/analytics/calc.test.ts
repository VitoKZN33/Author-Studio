import { describe, expect, it } from 'vitest';
import {
  bestTime,
  dailySeries,
  dayKeys,
  engagementRate,
  periodChange,
  valueAt,
  windowChange,
  type Snapshot,
} from './calc.js';

const TZ = 'Europe/Moscow';
const at = (iso: string) => new Date(iso);
const snap = (iso: string, value: number): Snapshot => ({ measuredAt: at(iso), value });

describe('dayKeys', () => {
  it('дни в поясе установки включительно', () => {
    expect(dayKeys(at('2026-10-20T00:00:00Z'), at('2026-10-22T22:30:00Z'), TZ)).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
  });
});

describe('dailySeries', () => {
  const days = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'];
  const snaps = [
    snap('2026-10-20T10:00:00Z', 95),
    snap('2026-10-21T08:00:00Z', 98),
    snap('2026-10-21T20:00:00Z', 100),
    snap('2026-10-23T09:00:00Z', 104),
  ];

  it('последнее измерение дня; день без измерений — null, а не 0; изменение к прошлому дню с данными', () => {
    const s = dailySeries(snaps, [], days, TZ, null);
    expect(s.map((p) => p.subscribers)).toEqual([100, null, 104, null]);
    expect(s.map((p) => p.change)).toEqual([5, null, 4, null]);
  });

  it('вступления/выходы — null до начала событий, затем счётчики', () => {
    const events = [
      { kind: 'join' as const, occurredAt: at('2026-10-23T10:00:00Z') },
      { kind: 'join' as const, occurredAt: at('2026-10-23T11:00:00Z') },
      { kind: 'leave' as const, occurredAt: at('2026-10-24T11:00:00Z') },
    ];
    const s = dailySeries(snaps, events, days, TZ, at('2026-10-22T12:00:00Z'));
    expect(s.map((p) => p.joins)).toEqual([null, 0, 2, 0]);
    expect(s.map((p) => p.leaves)).toEqual([null, 0, 0, 1]);
  });

  it('изменение за период — по первому и последнему дню с данными', () => {
    expect(periodChange(dailySeries(snaps, [], days, TZ, null))).toEqual({
      from: 100,
      to: 104,
      delta: 4,
      fromDay: '2026-10-21',
      toDay: '2026-10-23',
    });
    expect(periodChange(dailySeries([], [], days, TZ, null))).toBeNull();
  });
});

describe('windowChange', () => {
  const sorted = [
    snap('2026-10-14T09:00:00Z', 90),
    snap('2026-10-21T09:00:00Z', 104),
    snap('2026-10-22T09:30:00Z', 110),
  ];

  it('изменение за 24 ч после поста и база за неделю до него', () => {
    expect(
      windowChange(sorted, at('2026-10-21T09:10:00Z'), 24, at('2026-10-25T00:00:00Z')),
    ).toEqual({
      before: 104,
      after: 110,
      delta: 6,
      hours: 24,
      baselinePerDay: 2,
    });
  });

  it('нет измерения рядом с моментом или окно не закончилось — null', () => {
    expect(
      windowChange(sorted, at('2026-10-18T09:00:00Z'), 24, at('2026-10-25T00:00:00Z')),
    ).toBeNull();
    expect(
      windowChange(sorted, at('2026-10-21T09:10:00Z'), 24, at('2026-10-21T12:00:00Z')),
    ).toBeNull();
  });

  it('valueAt не берёт слишком старое измерение', () => {
    expect(valueAt(sorted, at('2026-10-21T12:00:00Z'), 3600_000)).toBeNull();
    expect(valueAt(sorted, at('2026-10-21T09:30:00Z'), 3600_000)?.value).toBe(104);
  });
});

describe('engagementRate', () => {
  it('процент с одним знаком; без данных — null', () => {
    expect(engagementRate(350, 1000)).toBe(35);
    expect(engagementRate(1, 3)).toBe(33.3);
    expect(engagementRate(null, 1000)).toBeNull();
    expect(engagementRate(10, 0)).toBeNull();
  });
});

describe('bestTime', () => {
  // Понедельник 26.10.2026, 09:00 МСК = 06:00 UTC → слот 3 (09–12).
  const monday9 = (week: number) =>
    at(new Date(Date.UTC(2026, 9, 26 + 7 * week, 6, 0)).toISOString());
  const friday21 = (week: number) =>
    at(new Date(Date.UTC(2026, 9, 30 + 7 * week, 18, 0)).toISOString());

  it('мало публикаций — вывода нет, но ячейки посчитаны', () => {
    const r = bestTime([{ postedAt: monday9(0), value: 10 }], TZ);
    expect(r.confidence).toBe('insufficient');
    expect(r.best).toBeNull();
    expect(r.cells.find((c) => c.weekday === 0 && c.slot === 3)).toMatchObject({ n: 1, avg: 10 });
  });

  it('достаточная выборка — лучшая ячейка выше среднего, надёжность «низкая»', () => {
    const posts = [
      ...Array.from({ length: 6 }, (_, i) => ({ postedAt: monday9(i), value: 30 })),
      ...Array.from({ length: 10 }, (_, i) => ({ postedAt: friday21(i), value: 10 })),
    ];
    const r = bestTime(posts, TZ);
    expect(r.total).toBe(16);
    expect(r.best).toMatchObject({ weekday: 0, slot: 3, n: 6, avg: 30 });
    expect(r.confidence).toBe('low');
  });
});
