import { describe, expect, it } from 'vitest';
import { isBotUserAgent, normalizeTarget } from './links.service.js';

describe('ссылки', () => {
  it('боты-превью не считаются кликами', () => {
    expect(isBotUserAgent('TelegramBot (like TwitterBot)')).toBe(true);
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true);
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      ),
    ).toBe(false);
  });
  it('адрес назначения — только http(s), без логина', () => {
    expect(normalizeTarget('https://ex.ru/a?b=1')).toBe('https://ex.ru/a?b=1');
    expect(() => normalizeTarget('javascript:alert(1)')).toThrow();
    expect(() => normalizeTarget('https://u:p@ex.ru')).toThrow();
    expect(() => normalizeTarget('ex.ru')).toThrow();
  });
});
