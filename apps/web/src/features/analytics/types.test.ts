import { describe, expect, it } from 'vitest';
import { heatColor, HEAT_STEPS, signed } from './types';

describe('аналитика: оформление значений', () => {
  it('знак изменения', () => {
    expect(signed(5)).toBe('+5');
    expect(signed(-3)).toBe('-3');
    expect(signed(0)).toBe('0');
  });
  it('шкала: минимум — первая ступень, максимум — последняя', () => {
    expect(heatColor(0, 10)).toBe(HEAT_STEPS[0]);
    expect(heatColor(10, 10)).toBe(HEAT_STEPS.at(-1));
    expect(heatColor(5, 0)).toBe(HEAT_STEPS[0]);
  });
});
