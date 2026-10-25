import { Module, type INestApplicationContext } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAppEnv, telegramEnv } from './env.js';

/**
 * Просмотры через аккаунт владельца (ADR-036). Настоящий Telegram (MTProto) не
 * вызывается: шлюз подменён имитацией, остальное — настоящие PostgreSQL и Redis.
 */

applyAppEnv(telegramEnv('http://127.0.0.1:1'));
const { NestFactory } = await import('@nestjs/core');
const { ConfigModule } = await import('../../src/config/config.module.js');
const { DatabaseModule, PG_POOL } = await import('../../src/database/database.module.js');
const { QueueModule, VIEWS_QUEUE } = await import('../../src/queue/queue.module.js');
const { AuditModule } = await import('../../src/audit/audit.module.js');
const { SettingsModule } = await import('../../src/settings/settings.module.js');
const { NotificationsModule } = await import('../../src/notifications/notifications.module.js');
const { MtprotoStore } = await import('../../src/mtproto/mtproto.store.js');
const { MtprotoService } = await import('../../src/mtproto/mtproto.service.js');
const { ViewsCollector } = await import('../../src/mtproto/views-collector.js');
const { MTPROTO_GATEWAY, MtprotoError } = await import('../../src/mtproto/gateway.js');
type Gateway = import('../../src/mtproto/gateway.js').MtprotoGateway;

const OWNER = 5550001n;
const SESSION = 'session-string-SECRET-1234567890';
const HASH = 'a'.repeat(32);

const calls: string[] = [];
let user: { id: bigint; displayName: string; phone: string | null } = {
  id: OWNER,
  displayName: 'Виталий',
  phone: '79001234567',
};
let needPassword = false;
let views = new Map<number, { views: number; forwards: number }>();
let fetchError: Error | null = null;

const fake: Gateway = {
  async startLogin(creds, phone) {
    calls.push(`start:${creds.apiId}:${phone}`);
    return { loginId: '11111111-1111-4111-8111-111111111111' };
  },
  async submitCode(_id, code) {
    calls.push(`code:${code}`);
    if (code === '00000') throw new MtprotoError('code_invalid');
    return needPassword
      ? { kind: 'password', hint: 'кот' }
      : { kind: 'done', session: SESSION, user };
  },
  async submitPassword(_id, password) {
    calls.push('password');
    if (password !== 'верный') throw new MtprotoError('password_invalid');
    return { session: SESSION, user };
  },
  async cancelLogin() {},
  async fetchViews(_c, session, channel, ids) {
    calls.push(`fetch:${channel.chatId}:${ids.length}:${session === SESSION}`);
    if (fetchError) throw fetchError;
    return ids.map((id) => ({
      id,
      views: views.get(id)?.views ?? null,
      forwards: views.get(id)?.forwards ?? null,
    }));
  },
  async logout(_c, session) {
    calls.push(`logout:${session === SESSION}`);
  },
};

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    QueueModule,
    AuditModule,
    SettingsModule,
    NotificationsModule,
  ],
  providers: [
    { provide: MTPROTO_GATEWAY, useValue: fake },
    MtprotoStore,
    MtprotoService,
    ViewsCollector,
  ],
})
class TestModule {}

let app: INestApplicationContext;
let channelId: string;
let ownerId: string;
const db = () => app.get(PG_POOL);
const svc = () => app.get(MtprotoService);
const collector = () => app.get(ViewsCollector);

async function login() {
  const { loginId } = await svc().startLogin(ownerId, {
    apiId: 123456,
    apiHash: HASH,
    phone: '+7 900 123-45-67',
  });
  return svc().submitCode(ownerId, loginId, '12345');
}

async function status(e: unknown): Promise<number> {
  return (e as { getStatus(): number }).getStatus();
}

beforeAll(async () => {
  app = await NestFactory.createApplicationContext(TestModule, { logger: false });
  await app.init();
  await db().query(
    'delete from message_metric_snapshots; delete from channel_messages; delete from mtproto_account; delete from publications; delete from posts; delete from sessions; delete from channels; delete from users;',
  );
  await app.get(VIEWS_QUEUE).obliterate({ force: true });
  // Задания из очереди в тесте не выполняются: сбор вызывается явно.
  await app.get(VIEWS_QUEUE).pause();
  ownerId = (
    await db().query("insert into users (telegram_id, role) values (5550001, 'owner') returning id")
  ).rows[0].id;
  channelId = (
    await db().query(
      "insert into channels (owner_id, tg_chat_id, title, username, status) values ($1, -1001234567890, 'Канал', null, 'active') returning id",
      [ownerId],
    )
  ).rows[0].id;
  for (const [id, ago] of [
    [10, 3],
    [11, 4],
    [12, 40],
  ] as const) {
    await db().query(
      `insert into channel_messages (channel_id, message_id, posted_at, summary, source) values ($1, $2, now() - interval '${ago} days', 'пост', 'channel_post')`,
      [channelId, id],
    );
  }
});

beforeEach(async () => {
  calls.length = 0;
  needPassword = false;
  fetchError = null;
  user = { id: OWNER, displayName: 'Виталий', phone: '79001234567' };
  views = new Map([
    [10, { views: 120, forwards: 3 }],
    [11, { views: 80, forwards: 0 }],
  ]);
  await db().query('delete from mtproto_account; delete from message_metric_snapshots');
});

afterAll(async () => {
  await app.get(VIEWS_QUEUE).resume();
  await app.close();
});

describe('подключение аккаунта', () => {
  it('вход по коду: сессия и api_hash только в зашифрованном виде, наружу — имя и маска номера', async () => {
    const r = await login();
    expect(r).toMatchObject({
      next: 'done',
      connected: true,
      status: 'active',
      displayName: 'Виталий',
    });
    expect(JSON.stringify(r)).not.toContain(SESSION);
    expect(r).toMatchObject({ phoneMask: '+7 ••• ••• 45 67' });
    expect(calls[0]).toBe('start:123456:+79001234567');
    const { rows } = await db().query('select * from mtproto_account');
    expect(JSON.stringify(rows)).not.toContain(SESSION);
    expect(JSON.stringify(rows)).not.toContain(HASH);
    expect(rows[0].session_encrypted).toMatch(/^v1\./);
    const audit = await db().query("select metadata from audit_log where action like 'mtproto.%'");
    expect(JSON.stringify(audit.rows)).not.toContain(SESSION);
  });

  it('двухэтапная проверка: сначала подсказка пароля, неверный пароль → 400, верный → подключено', async () => {
    needPassword = true;
    const { loginId } = await svc().startLogin(ownerId, {
      apiId: 1,
      apiHash: HASH,
      phone: '+79001234567',
    });
    expect(await svc().submitCode(ownerId, loginId, '12345')).toEqual({
      next: 'password',
      hint: 'кот',
    });
    const bad = await svc()
      .submitPassword(ownerId, loginId, 'нет')
      .catch((e: unknown) => e);
    expect(await status(bad)).toBe(400);
    expect((bad as Error).message).toMatch(/пароль/);
    expect(await svc().submitPassword(ownerId, loginId, 'верный')).toMatchObject({ next: 'done' });
  });

  it('неверный код → 400 с русским сообщением, ничего не сохранено', async () => {
    const { loginId } = await svc().startLogin(ownerId, {
      apiId: 1,
      apiHash: HASH,
      phone: '+79001234567',
    });
    const e = await svc()
      .submitCode(ownerId, loginId, '00000')
      .catch((x: unknown) => x);
    expect(await status(e)).toBe(400);
    expect((e as Error).message).toMatch(/Неверный код/);
    expect((await svc().view()).connected).toBe(false);
  });

  it('чужой аккаунт → 403, сеанс сразу завершается и не сохраняется', async () => {
    user = { id: 999n, displayName: 'Чужой', phone: null };
    const e = await login().catch((x: unknown) => x);
    expect(await status(e)).toBe(403);
    expect(calls).toContain('logout:true');
    expect((await svc().view()).connected).toBe(false);
  });

  it('неизвестный loginId → 400 «вход занял слишком много времени»', async () => {
    const e = await svc()
      .submitCode(ownerId, '22222222-2222-4222-8222-222222222222', '12345')
      .catch((x: unknown) => x);
    expect((e as Error).message).toMatch(/слишком много времени/);
  });

  it('отключение: сеанс завершается в Telegram, данные удаляются', async () => {
    await login();
    calls.length = 0;
    const r = await svc().disconnect(ownerId);
    expect(calls).toEqual(['logout:true']);
    expect(r).toMatchObject({ connected: false, status: 'disconnected' });
    const { rows } = await db().query(
      'select session_encrypted, api_hash_encrypted from mtproto_account',
    );
    expect(rows[0]).toEqual({ session_encrypted: null, api_hash_encrypted: null });
  });
});

describe('сбор просмотров', () => {
  it('свежие посты (до 48 ч) опрашиваются при каждом запуске и пишутся всегда', async () => {
    await login();
    await db().query(
      "insert into channel_messages (channel_id, message_id, posted_at, summary, source) values ($1, 20, now() - interval '2 hours', 'свежий', 'app')",
      [channelId],
    );
    views.set(20, { views: 15, forwards: 1 });
    await collector().syncAll(true);
    calls.length = 0;
    expect(await collector().syncAll()).toBe(2); // тот же результат — снова две точки
    expect(calls).toEqual(['fetch:-1001234567890:1:true']);
    await db().query('delete from channel_messages where message_id = 20');
  });

  it('без подключённого аккаунта ничего не делает', async () => {
    expect(await collector().syncAll()).toBe(0);
    expect(calls).toEqual([]);
  });

  it('записывает просмотры и пересылки постов за 30 дней; повтор без изменений — без новых строк', async () => {
    await login();
    calls.length = 0;
    expect(await collector().syncAll(true)).toBe(4);
    expect(calls).toEqual(['fetch:-1001234567890:2:true']); // пост 40-дневной давности не запрашивается
    const { rows } = await db().query(
      'select message_id, metric, value, source from message_metric_snapshots order by message_id, metric',
    );
    expect(rows).toEqual([
      { message_id: 10, metric: 'forwards', value: 3, source: 'mtproto' },
      { message_id: 10, metric: 'views', value: 120, source: 'mtproto' },
      { message_id: 11, metric: 'forwards', value: 0, source: 'mtproto' },
      { message_id: 11, metric: 'views', value: 80, source: 'mtproto' },
    ]);
    expect(await collector().syncAll(true)).toBe(0);
    views.set(10, { views: 150, forwards: 3 });
    // Не полный запуск: старые посты не опрашиваются.
    expect(await collector().syncAll()).toBe(0);
    expect(await collector().syncAll(true)).toBe(1);
    const st = await svc().view();
    expect(st).toMatchObject({ status: 'active', lastSyncCount: 1 });
    expect(st.lastSyncAt).not.toBeNull();
  });

  it('ограничение частоты → сбор откладывается до срока, следующий запуск пропускается', async () => {
    await login();
    fetchError = new MtprotoError('flood_wait', 'FLOOD_WAIT', 900);
    expect(await collector().syncAll()).toBe(0);
    const st = await svc().view();
    expect(st.status).toBe('flood_wait');
    expect(new Date(st.floodUntil!).getTime()).toBeGreaterThan(Date.now() + 800_000);
    calls.length = 0;
    fetchError = null;
    expect(await collector().syncAll()).toBe(0);
    expect(calls).toEqual([]);
  });

  it('сеанс завершён в Telegram → данные удалены, статус «ошибка», сбор остановлен', async () => {
    await login();
    fetchError = new MtprotoError('session_revoked', 'AUTH_KEY_UNREGISTERED');
    await collector().syncAll();
    const st = await svc().view();
    expect(st).toMatchObject({ connected: false, status: 'error' });
    expect(st.lastError).toMatch(/Подключите аккаунт заново/);
  });
});
