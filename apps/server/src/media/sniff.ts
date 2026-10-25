/**
 * Определение типа файла по сигнатуре (первые байты), а не по имени или заголовку
 * Content-Type от клиента. Поддерживаются форматы, которые Telegram принимает
 * в sendPhoto / sendVideo без перекодирования.
 */
export interface SniffResult {
  kind: 'photo' | 'video';
  mime: string;
  ext: string;
}

export function sniffMedia(head: Buffer): SniffResult | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { kind: 'photo', mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    head.length >= 8 &&
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { kind: 'photo', mime: 'image/png', ext: 'png' };
  }
  if (
    head.length >= 12 &&
    head.toString('latin1', 0, 4) === 'RIFF' &&
    head.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return { kind: 'photo', mime: 'image/webp', ext: 'webp' };
  }
  if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') {
    const brand = head.toString('latin1', 8, 12);
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime', ext: 'mov' };
    // Изображения HEIC/AVIF тоже используют ftyp — Telegram не примет их как фото.
    if (/^(heic|heix|mif1|msf1|avif)$/.test(brand)) return null;
    return { kind: 'video', mime: 'video/mp4', ext: 'mp4' };
  }
  return null;
}
