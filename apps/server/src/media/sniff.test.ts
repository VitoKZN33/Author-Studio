import { describe, expect, it } from 'vitest';
import { sniffMedia } from './sniff.js';

const b = (...bytes: (number | string)[]) =>
  Buffer.concat(
    bytes.map((x) => (typeof x === 'string' ? Buffer.from(x, 'latin1') : Buffer.from([x]))),
  );

describe('sniffMedia', () => {
  it('распознаёт JPEG, PNG, WebP, MP4, MOV', () => {
    expect(sniffMedia(b(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe('image/jpeg');
    expect(sniffMedia(b(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe('image/png');
    expect(sniffMedia(b('RIFF', 0, 0, 0, 0, 'WEBP'))?.mime).toBe('image/webp');
    expect(sniffMedia(b(0, 0, 0, 0x18, 'ftyp', 'isom'))?.kind).toBe('video');
    expect(sniffMedia(b(0, 0, 0, 0x14, 'ftyp', 'qt  '))?.mime).toBe('video/quicktime');
  });

  it('отклоняет HEIC, GIF, HTML и исполняемые файлы, даже если имя «.jpg»', () => {
    expect(sniffMedia(b(0, 0, 0, 0x18, 'ftyp', 'heic'))).toBeNull();
    expect(sniffMedia(b('GIF89a'))).toBeNull();
    expect(sniffMedia(b('<html><script>'))).toBeNull();
    expect(sniffMedia(b(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
    expect(sniffMedia(Buffer.alloc(0))).toBeNull();
  });
});
