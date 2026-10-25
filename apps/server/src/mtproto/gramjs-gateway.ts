import bigInt from 'big-integer';
import { createHash, randomUUID } from 'node:crypto';
import { Api, TelegramClient } from 'telegram';
import { errors } from 'telegram';
import { Logger as GramLogger, LogLevel } from 'telegram/extensions/Logger.js';
import { computeCheck } from 'telegram/Password.js';
import { StringSession } from 'telegram/sessions/index.js';
import type { ProxyInterface } from 'telegram/network/connection/TCPMTProxy.js';
import {
  MtprotoError,
  type ChannelRef,
  type CodeResult,
  type MessageViews,
  type MtprotoCredentials,
  type MtprotoGateway,
  type MtprotoUser,
} from './gateway.js';

/** Вход ждёт код и пароль не дольше 10 минут. */
const LOGIN_TTL_MS = 10 * 60_000;
const OP_TIMEOUT_MS = 30_000;

/** socks5://логин:пароль@хост:порт → прокси GramJS. HTTP-прокси MTProto не поддерживает. */
export function proxyFromUrl(url: string | undefined): ProxyInterface | undefined {
  if (!url || !/^socks5h?:\/\//i.test(url)) return undefined;
  const u = new URL(url.replace(/^socks5h:/i, 'socks5:'));
  return {
    ip: u.hostname,
    port: Number(u.port || 1080),
    socksType: 5,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    timeout: 15,
  };
}

/** Ошибка GramJS → код шлюза. Текст ошибки Telegram сохраняется как detail (без секретов). */
export function mapError(err: unknown): MtprotoError {
  if (err instanceof MtprotoError) return err;
  if (err instanceof errors.FloodWaitError) {
    return new MtprotoError('flood_wait', err.errorMessage, err.seconds);
  }
  const message =
    err instanceof errors.RPCError
      ? err.errorMessage
      : err instanceof Error
        ? err.message
        : String(err);
  const is = (...codes: string[]) => codes.some((c) => message.includes(c));
  if (is('API_ID_INVALID', 'API_ID_PUBLISHED_FLOOD'))
    return new MtprotoError('api_id_invalid', message);
  if (is('PHONE_NUMBER_BANNED')) return new MtprotoError('phone_banned', message);
  if (is('PHONE_NUMBER_INVALID', 'PHONE_NUMBER_UNOCCUPIED'))
    return new MtprotoError('phone_invalid', message);
  if (is('PHONE_CODE_EXPIRED')) return new MtprotoError('code_expired', message);
  if (is('PHONE_CODE_INVALID', 'PHONE_CODE_EMPTY'))
    return new MtprotoError('code_invalid', message);
  if (is('PASSWORD_HASH_INVALID')) return new MtprotoError('password_invalid', message);
  if (
    is(
      'AUTH_KEY_UNREGISTERED',
      'SESSION_REVOKED',
      'USER_DEACTIVATED',
      'AUTH_KEY_DUPLICATED',
      'SESSION_EXPIRED',
    )
  )
    return new MtprotoError('session_revoked', message);
  if (
    is(
      'CHANNEL_PRIVATE',
      'CHANNEL_INVALID',
      'CHAT_ADMIN_REQUIRED',
      'PEER_ID_INVALID',
      'Could not find the input entity',
    )
  )
    return new MtprotoError('channel_unavailable', message);
  if (
    is(
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'socket',
      'Socket',
      'timeout',
      'Timeout',
      'Not connected',
    )
  )
    return new MtprotoError('network', message);
  return new MtprotoError('unknown', message.slice(0, 200));
}

function withTimeout<T>(p: Promise<T>, ms = OP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MtprotoError('network', 'timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

interface PendingLogin {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
  expires: number;
}

/** Реализация шлюза на GramJS (официальный MTProto API). */
export class GramJsGateway implements MtprotoGateway {
  private readonly pending = new Map<string, PendingLogin>();
  /** Подключённые клиенты для сбора: по отпечатку сессии (сама сессия ключом не служит). */
  private readonly clients = new Map<string, { client: TelegramClient; dialogsLoaded: boolean }>();

  constructor(private readonly proxyUrl?: string) {}

  private newClient(creds: MtprotoCredentials, session = ''): TelegramClient {
    const logger = new GramLogger(LogLevel.NONE);
    return new TelegramClient(new StringSession(session), creds.apiId, creds.apiHash, {
      connectionRetries: 2,
      proxy: proxyFromUrl(this.proxyUrl),
      deviceModel: 'Author Studio (сервер)',
      systemVersion: 'Linux',
      appVersion: '0.1',
      langCode: 'ru',
      systemLangCode: 'ru',
      baseLogger: logger,
      // Короткие ожидания при лимитах GramJS выполняет сам; длинные возвращает ошибкой.
      floodSleepThreshold: 30,
    });
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, p] of this.pending) {
      if (p.expires < now) {
        this.pending.delete(id);
        void p.client.disconnect().catch(() => undefined);
      }
    }
  }

  private take(loginId: string): PendingLogin {
    this.sweep();
    const p = this.pending.get(loginId);
    if (!p) throw new MtprotoError('login_expired');
    return p;
  }

  private async finish(
    loginId: string,
    p: PendingLogin,
  ): Promise<{ session: string; user: MtprotoUser }> {
    const me = (await withTimeout(p.client.getMe())) as Api.User;
    const session = (p.client.session as StringSession).save();
    this.pending.delete(loginId);
    await p.client.disconnect().catch(() => undefined);
    const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.username || 'Аккаунт';
    return {
      session,
      user: { id: BigInt(me.id.toString()), displayName: name, phone: me.phone ?? null },
    };
  }

  async startLogin(creds: MtprotoCredentials, phone: string): Promise<{ loginId: string }> {
    this.sweep();
    const client = this.newClient(creds);
    try {
      await withTimeout(client.connect());
      const r = await withTimeout(client.sendCode(creds, phone));
      const loginId = randomUUID();
      this.pending.set(loginId, {
        client,
        phone,
        phoneCodeHash: r.phoneCodeHash,
        expires: Date.now() + LOGIN_TTL_MS,
      });
      return { loginId };
    } catch (e) {
      await client.disconnect().catch(() => undefined);
      throw mapError(e);
    }
  }

  async submitCode(loginId: string, code: string): Promise<CodeResult> {
    const p = this.take(loginId);
    try {
      const r = await withTimeout(
        p.client.invoke(
          new Api.auth.SignIn({
            phoneNumber: p.phone,
            phoneCodeHash: p.phoneCodeHash,
            phoneCode: code,
          }),
        ),
      );
      if (r instanceof Api.auth.AuthorizationSignUpRequired)
        throw new MtprotoError('phone_invalid', 'аккаунт с этим номером не зарегистрирован');
      const done = await this.finish(loginId, p);
      return { kind: 'done', ...done };
    } catch (e) {
      const msg = e instanceof errors.RPCError ? e.errorMessage : '';
      if (msg === 'SESSION_PASSWORD_NEEDED') {
        const pwd = await withTimeout(p.client.invoke(new Api.account.GetPassword()));
        return { kind: 'password', hint: pwd.hint ?? null };
      }
      throw mapError(e);
    }
  }

  async submitPassword(loginId: string, password: string) {
    const p = this.take(loginId);
    try {
      const pwd = await withTimeout(p.client.invoke(new Api.account.GetPassword()));
      const check = await computeCheck(pwd, password);
      await withTimeout(p.client.invoke(new Api.auth.CheckPassword({ password: check })));
      return await this.finish(loginId, p);
    } catch (e) {
      throw mapError(e);
    }
  }

  async cancelLogin(loginId: string): Promise<void> {
    const p = this.pending.get(loginId);
    this.pending.delete(loginId);
    await p?.client.disconnect().catch(() => undefined);
  }

  private async clientFor(creds: MtprotoCredentials, session: string) {
    const key = createHash('sha256').update(session).digest('hex');
    let entry = this.clients.get(key);
    if (!entry) {
      // Сессия сменилась — старые клиенты закрываем.
      for (const [k, v] of this.clients) {
        void v.client.disconnect().catch(() => undefined);
        this.clients.delete(k);
      }
      entry = { client: this.newClient(creds, session), dialogsLoaded: false };
      this.clients.set(key, entry);
    }
    if (!entry.client.connected) await withTimeout(entry.client.connect());
    return entry;
  }

  async fetchViews(
    creds: MtprotoCredentials,
    session: string,
    channel: ChannelRef,
    messageIds: number[],
  ): Promise<MessageViews[]> {
    if (messageIds.length === 0) return [];
    try {
      const entry = await this.clientFor(creds, session);
      const { client } = entry;
      const peerChannel = new Api.PeerChannel({
        channelId: bigInt(String(-channel.chatId - 1_000_000_000_000n)),
      });
      let peer: Api.TypeInputPeer;
      try {
        peer = await withTimeout(
          channel.username
            ? client.getInputEntity(channel.username)
            : client.getInputEntity(peerChannel),
        );
      } catch {
        // access_hash канала есть в списке диалогов владельца — загружаем его один раз.
        if (!entry.dialogsLoaded) {
          await withTimeout(client.getDialogs({ limit: 300 }), 60_000);
          entry.dialogsLoaded = true;
        }
        peer = await withTimeout(client.getInputEntity(peerChannel));
      }
      const r = await withTimeout(
        client.invoke(
          new Api.messages.GetMessagesViews({
            peer,
            id: messageIds.slice(0, 100),
            increment: false,
          }),
        ),
      );
      return r.views.map((v, i) => ({
        id: messageIds[i]!,
        views: v.views ?? null,
        forwards: v.forwards ?? null,
      }));
    } catch (e) {
      throw mapError(e);
    }
  }

  async logout(creds: MtprotoCredentials, session: string): Promise<void> {
    for (const [k, v] of this.clients) {
      void v.client.disconnect().catch(() => undefined);
      this.clients.delete(k);
    }
    const client = this.newClient(creds, session);
    try {
      await withTimeout(client.connect());
      await withTimeout(client.invoke(new Api.auth.LogOut()));
    } catch {
      // Сессия могла быть уже завершена в Telegram — данные у нас удаляются в любом случае.
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  }
}
