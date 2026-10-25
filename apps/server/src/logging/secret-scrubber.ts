import { Writable } from 'node:stream';

const REDACTED = '[СКРЫТО]';
/** Формат токена бота Telegram: <id>:<35+ символов>. */
const BOT_TOKEN_RE = /\b\d{5,}:[A-Za-z0-9_-]{30,}\b/g;
/** Пароль в строке подключения: scheme://user:password@host. */
const URL_PASSWORD_RE = /([a-z][a-z0-9+.-]*:\/\/[^:/\s"@]*:)[^@\s"]+@/gi;
/** Bearer-токены и типичные ключи API (sk-…). */
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi;
const API_KEY_RE = /\bsk-[A-Za-z0-9_-]{16,}\b/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Удаляет секреты из строки: известные значения (из конфигурации) и
 * распознаваемые по формату (токены ботов, пароли в URL, Bearer, sk-ключи).
 */
export function createSecretScrubber(knownSecrets: readonly (string | undefined)[]) {
  const known = knownSecrets
    .filter((s): s is string => typeof s === 'string' && s.length >= 6)
    .sort((a, b) => b.length - a.length)
    .map((s) => new RegExp(escapeRegExp(s), 'g'));
  const knownJson = knownSecrets
    .filter((s): s is string => typeof s === 'string' && s.length >= 6)
    .map((s) => JSON.stringify(s).slice(1, -1))
    .filter((s) => s !== undefined)
    .map((s) => new RegExp(escapeRegExp(s), 'g'));

  return (input: string): string => {
    let out = input;
    for (const re of [...known, ...knownJson]) out = out.replace(re, REDACTED);
    return out
      .replace(BOT_TOKEN_RE, REDACTED)
      .replace(URL_PASSWORD_RE, `$1${REDACTED}@`)
      .replace(BEARER_RE, `$1${REDACTED}`)
      .replace(API_KEY_RE, REDACTED);
  };
}

/** Поток вывода логов, пропускающий каждую строку через фильтр секретов. */
export function createScrubbingStream(
  scrub: (s: string) => string,
  target: NodeJS.WritableStream = process.stdout,
): Writable {
  return new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      target.write(scrub(chunk.toString()));
      cb();
    },
  });
}
