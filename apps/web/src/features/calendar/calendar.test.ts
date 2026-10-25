import { describe, expect, it } from 'vitest';
import { monthGrid } from './calendar-screen';

describe('monthGrid', () => {
  it('октябрь 2026 начинается с четверга: сетка с понедельника 28 сентября', () => {
    const g = monthGrid(2026, 10);
    expect(g[0]).toBe('2026-09-28');
    expect(g).toContain('2026-10-31');
    expect(g.length % 7).toBe(0);
  });

  it('февраль 2027 (начинается с понедельника) — 4 недели без пустой строки', () => {
    const g = monthGrid(2027, 2);
    expect(g[0]).toBe('2027-02-01');
    expect(g).toHaveLength(35);
  });
});
