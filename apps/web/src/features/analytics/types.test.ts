import { describe, expect, it } from 'vitest';
import { heatIndex, HEAT_STEPS, signed } from './types';

describe('аналитика: оформление значений', () => {
  it('знак изменения', () => {
    expect(signed(5)).toBe('+5');
    expect(signed(-3)).toBe('-3');
    expect(signed(0)).toBe('0');
  });
  it('шкала: минимум — первая ступень, максимум — последняя', () => {
    expect(heatIndex(0, 10)).toBe(0);
    expect(heatIndex(10, 10)).toBe(HEAT_STEPS - 1);
    expect(heatIndex(5, 0)).toBe(0);
  });
});
