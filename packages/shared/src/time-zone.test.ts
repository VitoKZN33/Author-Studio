import { describe, expect, it } from 'vitest';
import { utcToZonedWallTime, zonedDayKey, zonedWallTimeToUtc } from './time-zone';

describe('часовые пояса установки', () => {
  it('Москва: UTC+3 без перехода на летнее время', () => {
    expect(zonedWallTimeToUtc('2026-10-25T14:30', 'Europe/Moscow').toISOString()).toBe(
      '2026-10-25T11:30:00.000Z',
    );
    expect(utcToZonedWallTime(new Date('2026-10-25T11:30:00Z'), 'Europe/Moscow')).toBe(
      '2026-10-25T14:30',
    );
  });

  it('Берлин: летнее и зимнее время различаются', () => {
    expect(zonedWallTimeToUtc('2026-07-01T12:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-07-01T10:00:00.000Z',
    );
    expect(zonedWallTimeToUtc('2026-12-01T12:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-12-01T11:00:00.000Z',
    );
  });

  it('туда и обратно без потерь для произвольных моментов', () => {
    for (const iso of ['2026-03-29T01:30:00Z', '2026-10-25T02:30:00Z', '2026-01-01T23:15:00Z']) {
      const wall = utcToZonedWallTime(new Date(iso), 'Europe/Berlin');
      expect(zonedWallTimeToUtc(wall, 'Europe/Berlin').toISOString()).toBe(
        new Date(iso).toISOString(),
      );
    }
  });

  it('осенний переход: повторяющийся час — первое наступление; весенний — сдвиг вперёд', () => {
    // 25.10.2026 в Берлине 02:30 бывает дважды (летнее 00:30Z и зимнее 01:30Z).
    expect(zonedWallTimeToUtc('2026-10-25T02:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    // 29.03.2026 в Берлине 02:30 не существует — получаем 03:30 летнего времени.
    expect(
      utcToZonedWallTime(zonedWallTimeToUtc('2026-03-29T02:30', 'Europe/Berlin'), 'Europe/Berlin'),
    ).toBe('2026-03-29T03:30');
  });

  it('день в поясе установки, а не UTC', () => {
    expect(zonedDayKey(new Date('2026-10-25T22:30:00Z'), 'Europe/Moscow')).toBe('2026-10-26');
  });

  it('неверный формат → ошибка', () => {
    expect(() => zonedWallTimeToUtc('25.10.2026 14:30', 'Europe/Moscow')).toThrow();
  });
});
