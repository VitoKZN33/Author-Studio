import { describe, expect, it } from 'vitest';
import { maskSecret, SecretBox } from './secret-box.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('SecretBox', () => {
  const box = new SecretBox(KEY);

  it('шифрует и расшифровывает; шифртекст не содержит исходного значения', () => {
    const sealed = box.encrypt('sk-test-1234567890abcdef', 'a');
    expect(sealed).not.toContain('sk-test');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(box.decrypt(sealed, 'a')).toBe('sk-test-1234567890abcdef');
  });

  it('каждый раз новый IV', () => {
    expect(box.encrypt('x')).not.toBe(box.encrypt('x'));
  });

  it('подмена шифртекста, тега или AAD → ошибка', () => {
    const sealed = box.encrypt('secret', 'a');
    const [v, iv, tag, ct] = sealed.split('.');
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    expect(() => box.decrypt([v, iv, tag, flip(ct!)].join('.'), 'a')).toThrow();
    expect(() => box.decrypt([v, iv, flip(tag!), ct].join('.'), 'a')).toThrow();
    expect(() => box.decrypt([v, iv, tag!.slice(0, 4), ct].join('.'), 'a')).toThrow();
    expect(() => box.decrypt(sealed, 'b')).toThrow();
    expect(() => box.decrypt('garbage', 'a')).toThrow();
  });

  it('другой мастер-ключ не расшифровывает', () => {
    const other = new SecretBox(Buffer.alloc(32, 8).toString('base64'));
    expect(() => other.decrypt(box.encrypt('s'))).toThrow();
  });

  it('маска показывает только последние 4 символа', () => {
    expect(maskSecret('sk-abcdefghijklmnop')).toBe('…mnop');
    expect(maskSecret('short')).toBe('…');
  });
});
