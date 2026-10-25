import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeCall {
  method: string;
  params: Record<string, unknown>;
}

type Handler = (params: Record<string, unknown>) => unknown;

/**
 * Минимальная имитация Bot API (https://api.telegram.org/bot<token>/<method>).
 * Ответы задаются тестом; по умолчанию методы возвращают true.
 * Обработчик может бросить FakeTelegramError, чтобы вернуть ошибку Telegram.
 */
export class FakeTelegramError {
  constructor(
    public readonly code: number,
    public readonly description: string,
    public readonly retryAfter?: number,
  ) {}
}

/** Обработчик бросает это, чтобы оборвать соединение без ответа (как сбой сети). */
export class FakeTelegramDrop {}

export class FakeTelegram {
  calls: FakeCall[] = [];
  private handlers = new Map<string, Handler>();
  private server?: Server;
  url = '';

  on(method: string, handler: Handler): this {
    this.handlers.set(method, handler);
    return this;
  }

  reset(): void {
    this.calls = [];
    this.handlers.clear();
  }

  callsOf(method: string): FakeCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const method = (req.url ?? '').split('/').pop() ?? '';
        const buf = Buffer.concat(chunks);
        const multipart = (req.headers['content-type'] ?? '').startsWith('multipart/');
        const params: Record<string, unknown> = multipart
          ? { multipart: true, bytes: buf.length, raw: buf.toString('utf8', 0, 4000) }
          : buf.length
            ? (JSON.parse(buf.toString('utf8')) as Record<string, unknown>)
            : {};
        this.calls.push({ method, params });
        res.setHeader('content-type', 'application/json');
        try {
          const handler = this.handlers.get(method);
          const result = handler ? handler(params) : true;
          res.end(JSON.stringify({ ok: true, result }));
        } catch (e) {
          if (e instanceof FakeTelegramDrop) {
            req.socket.destroy();
            return;
          }
          if (e instanceof FakeTelegramError) {
            res.statusCode = e.code;
            res.end(
              JSON.stringify({
                ok: false,
                error_code: e.code,
                description: e.description,
                ...(e.retryAfter ? { parameters: { retry_after: e.retryAfter } } : {}),
              }),
            );
            return;
          }
          throw e;
        }
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((r) => this.server?.close(() => r()));
  }

  /** Временно перестать принимать соединения (имитация недоступности — ECONNREFUSED). */
  async pause(): Promise<void> {
    await this.stop();
  }

  async resume(): Promise<void> {
    const port = Number(new URL(this.url).port);
    await new Promise<void>((r) => this.server!.listen(port, '127.0.0.1', r));
  }
}

export const BOT_TOKEN = '777000111:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
export const BOT_ID = 777000111;
export const OWNER_ID = 5550001;
export const WEBHOOK_SECRET = 'test-webhook-secret-0123456789abcdef';

export function adminMember(userId: number, rights: Record<string, boolean> = {}) {
  return {
    status: 'administrator',
    user: { id: userId, is_bot: true, first_name: 'bot' },
    can_be_edited: false,
    is_anonymous: false,
    can_manage_chat: true,
    can_delete_messages: true,
    can_manage_video_chats: false,
    can_restrict_members: false,
    can_promote_members: false,
    can_change_info: false,
    can_invite_users: true,
    can_post_stories: false,
    can_edit_stories: false,
    can_delete_stories: false,
    can_post_messages: true,
    can_edit_messages: true,
    ...rights,
  };
}

export function channelChat(id: number, username = 'test_channel', title = 'Тестовый канал') {
  return { id, type: 'channel', title, username, accent_color_id: 0, max_reaction_count: 11 };
}

/** Ожидание условия с опросом. */
export async function waitFor<T>(
  fn: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('Условие не выполнилось вовремя');
    await new Promise((r) => setTimeout(r, 100));
  }
}
