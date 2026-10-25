import { describe, expect, it } from 'vitest';
import { sanitizeMetadata } from './audit.service.js';

describe('sanitizeMetadata', () => {
  it('удаляет поля с секретами, в том числе вложенные', () => {
    const out = sanitizeMetadata({
      channelId: 42,
      botToken: 'x',
      ai: { model: 'deepseek-chat', apiKey: 'y' },
      Authorization: 'Bearer z',
    });
    expect(out).toEqual({ channelId: 42, ai: { model: 'deepseek-chat' } });
  });
});
