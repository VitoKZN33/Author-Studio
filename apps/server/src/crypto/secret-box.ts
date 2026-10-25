import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Шифрование секретов, которые владелец вводит в интерфейсе (ключ AI-провайдера).
 * AES-256-GCM, мастер-ключ — APP_ENCRYPTION_KEY из env (в БД не хранится).
 * Формат: v1.<iv base64url>.<tag base64url>.<шифртекст base64url>.
 * Подмена любой части → ошибка расшифровки, а не мусор.
 */
const VERSION = 'v1';

export class SecretBox {
  private readonly key: Buffer;

  constructor(masterKeyBase64: string) {
    this.key = Buffer.from(masterKeyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('APP_ENCRYPTION_KEY должен быть 32 байта');
  }

  encrypt(plain: string, aad = ''): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  decrypt(sealed: string, aad = ''): string {
    const [version, iv, tag, ct] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || ct === undefined) {
      throw new Error('Неизвестный формат зашифрованного значения');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'), {
      authTagLength: 16,
    });
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

/** Маска ключа для интерфейса: только последние 4 символа. */
export function maskSecret(secret: string): string {
  const tail = secret.slice(-4);
  return secret.length > 8 ? `…${tail}` : '…';
}
