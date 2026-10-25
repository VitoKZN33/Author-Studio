import { describe, expect, it } from 'vitest';
import ru from '../../messages/ru.json';
import { SECTIONS } from './sections';

function collectEmpty(obj: unknown, path = ''): string[] {
  if (typeof obj === 'string') return obj.trim() === '' ? [path] : [];
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => collectEmpty(v, path ? `${path}.${k}` : k));
  }
  return [];
}

describe('локализация', () => {
  it('у каждого раздела навигации есть подпись на русском', () => {
    for (const s of SECTIONS) expect(ru.nav[s.key]).toMatch(/[А-Яа-яЁё]/);
  });

  it('в словаре нет пустых строк', () => {
    expect(collectEmpty(ru)).toEqual([]);
  });
});
