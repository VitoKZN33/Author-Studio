import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Queue, Worker } from 'bullmq';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { DB, type Database } from '../database/database.module.js';
import { channelMessages, channels, messageMetricSnapshots } from '../database/schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { BULL_CONNECTION, VIEWS_QUEUE } from '../queue/queue.module.js';
import { createWorker, QUEUE_NAMES } from '../queue/queues.js';
import { MTPROTO_GATEWAY, MtprotoError, type MtprotoGateway } from './gateway.js';
import { SYNC_ALL_JOB } from './mtproto.service.js';
import { MTPROTO_MESSAGES, MtprotoStore } from './mtproto.store.js';

/** Посты за последние 30 дней: позже просмотры почти не меняются. */
const WINDOW_DAYS = 30;
/** Свежие посты (до 48 ч) опрашиваются каждые 15 минут: для просмотров через 1, 6, 24 и 48 ч. */
const FRESH_HOURS = 48;
const FRESH_INTERVAL_MS = 15 * 60_000;
const MAX_MESSAGES = 300;
const BATCH = 100;

/**
 * Раз в VIEWS_SYNC_INTERVAL_MINUTES забирает просмотры и пересылки постов через
 * аккаунт владельца. Пишет снимок, только если значение изменилось. Один вызов
 * messages.getMessagesViews на 100 постов канала — бережно к лимитам аккаунта.
 */
@Injectable()
export class ViewsCollector implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ViewsCollector.name);
  private worker?: Worker;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(BULL_CONNECTION) private readonly connection: Redis,
    @Inject(VIEWS_QUEUE) private readonly queue: Queue,
    @Inject(MTPROTO_GATEWAY) private readonly gateway: MtprotoGateway,
    private readonly store: MtprotoStore,
    private readonly notifications: NotificationsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.worker = createWorker(
      QUEUE_NAMES.views,
      (job) => this.syncAll(!!(job.data as { force?: boolean } | undefined)?.force),
      this.connection,
    );
    await this.queue
      .upsertJobScheduler('views-schedule', { every: FRESH_INTERVAL_MS }, { name: SYNC_ALL_JOB })
      .catch((err: Error) =>
        this.logger.error({ err: err.message }, 'Не удалось запустить сбор просмотров'),
      );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  /**
   * Свежие посты — при каждом запуске (снимок пишется всегда: это точки «через N часов»),
   * остальные — раз в VIEWS_SYNC_INTERVAL_MINUTES и только при изменении значения.
   * Возвращает число записанных снимков; без подключённого аккаунта ничего не делает.
   */
  async syncAll(force = false): Promise<number> {
    const s = await this.store.secrets();
    if (!s || s.row.status === 'error' || s.row.status === 'disconnected') return 0;
    if (s.row.floodUntil && s.row.floodUntil.getTime() > Date.now()) return 0;
    const full =
      force ||
      !s.row.lastSyncAt ||
      Date.now() - s.row.lastSyncAt.getTime() >=
        this.config.VIEWS_SYNC_INTERVAL_MINUTES * 60_000 - 60_000;

    const list = await this.db
      .select({ id: channels.id, tgChatId: channels.tgChatId, username: channels.username })
      .from(channels)
      .where(eq(channels.status, 'active'));
    let written = 0;
    const problems: string[] = [];
    for (const c of list) {
      try {
        written += await this.syncChannel(s, c, full);
      } catch (e) {
        const err = e instanceof MtprotoError ? e : new MtprotoError('unknown', String(e));
        if (err.code === 'flood_wait') {
          await this.store.update({
            status: 'flood_wait',
            floodUntil: new Date(Date.now() + (err.seconds ?? 600) * 1000),
            lastError: MTPROTO_MESSAGES.flood_wait!,
          });
          this.logger.warn({ seconds: err.seconds }, 'MTProto: ограничение частоты, сбор отложен');
          return written;
        }
        if (err.code === 'session_revoked') {
          await this.store.clear('error', MTPROTO_MESSAGES.session_revoked!);
          await this.notifications
            .notifyOwner({
              category: 'integration',
              text: '⚠️ Сбор просмотров остановлен: сеанс аккаунта завершён в Telegram. Подключите аккаунт заново в разделе «Ещё → Просмотры».',
              openPath: '/views/',
              dedupeKey: 'mtproto-revoked',
            })
            .catch(() => undefined);
          return written;
        }
        this.logger.warn(
          { channelId: c.id, code: err.code, detail: err.detail },
          'MTProto: канал пропущен',
        );
        problems.push(MTPROTO_MESSAGES[err.code] ?? MTPROTO_MESSAGES.unknown!);
      }
    }
    await this.store.update({
      status: 'active',
      floodUntil: null,
      lastError: problems[0] ?? null,
      ...(full ? { lastSyncAt: new Date(), lastSyncCount: written } : {}),
    });
    return written;
  }

  private async syncChannel(
    s: NonNullable<Awaited<ReturnType<MtprotoStore['secrets']>>>,
    c: { id: string; tgChatId: bigint; username: string | null },
    full: boolean,
  ): Promise<number> {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
    const freshSince = Date.now() - FRESH_HOURS * 3600_000;
    const all = await this.db
      .select({ messageId: channelMessages.messageId, postedAt: channelMessages.postedAt })
      .from(channelMessages)
      .where(and(eq(channelMessages.channelId, c.id), gte(channelMessages.postedAt, since)))
      .orderBy(desc(channelMessages.postedAt))
      .limit(MAX_MESSAGES);
    const fresh = new Set(
      all.filter((m) => m.postedAt.getTime() >= freshSince).map((m) => m.messageId),
    );
    const ids = all.map((m) => m.messageId).filter((id) => full || fresh.has(id));
    if (ids.length === 0) return 0;

    // Последние известные значения — чтобы не плодить одинаковые снимки.
    const latest = new Map<string, number>();
    const prev = await this.db
      .select({
        messageId: messageMetricSnapshots.messageId,
        metric: messageMetricSnapshots.metric,
        value: messageMetricSnapshots.value,
      })
      .from(messageMetricSnapshots)
      .where(
        and(
          eq(messageMetricSnapshots.channelId, c.id),
          inArray(messageMetricSnapshots.messageId, ids),
          inArray(messageMetricSnapshots.metric, ['views', 'forwards']),
        ),
      )
      .orderBy(desc(messageMetricSnapshots.measuredAt), desc(messageMetricSnapshots.id));
    for (const p of prev) {
      const k = `${p.messageId}:${p.metric}`;
      if (!latest.has(k)) latest.set(k, p.value);
    }

    const rows: (typeof messageMetricSnapshots.$inferInsert)[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const part = ids.slice(i, i + BATCH);
      const views = await this.gateway.fetchViews(
        s.creds,
        s.session,
        { chatId: c.tgChatId, username: c.username },
        part,
      );
      for (const v of views) {
        for (const metric of ['views', 'forwards'] as const) {
          const value = v[metric];
          if (value === null) continue;
          if (!fresh.has(v.id) && latest.get(`${v.id}:${metric}`) === value) continue;
          rows.push({ channelId: c.id, messageId: v.id, metric, value, source: 'mtproto' });
        }
      }
    }
    if (rows.length) await this.db.insert(messageMetricSnapshots).values(rows);
    return rows.length;
  }
}
