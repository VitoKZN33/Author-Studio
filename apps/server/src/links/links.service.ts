import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, countDistinct, desc, eq, gte, isNull } from 'drizzle-orm';
import { createHmac, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { DB, type Database } from '../database/database.module.js';
import { channels, linkClicks, trackedLinks } from '../database/schema.js';

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newSlug(len = 8): string {
  const bytes = randomBytes(len);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Запросы предпросмотра ссылок (мессенджеры, соцсети, поисковики) — не клики людей. */
const BOT_UA =
  /bot|crawler|spider|preview|facebookexternalhit|vkshare|whatsapp|skypeuripreview|slack|discord|embedly|quora link|outbrain|pinterest|bitlybot|curl|wget|python-requests|go-http-client|headless/i;

export function isBotUserAgent(ua: string | undefined): boolean {
  return !ua || BOT_UA.test(ua);
}

/** Адрес назначения: только http(s), без учётных данных в URL. */
export function normalizeTarget(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new BadRequestException('Укажите полный адрес, начиная с https://');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    throw new BadRequestException('Ссылка должна вести на адрес http:// или https://');
  if (u.username || u.password)
    throw new BadRequestException('Адрес не должен содержать логин и пароль');
  return u.toString();
}

/** Отслеживаемые ссылки и учёт переходов (без хранения IP). */
@Injectable()
export class LinksService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  shortUrl(slug: string): string {
    return `${this.config.PUBLIC_URL.replace(/\/+$/, '')}/r/${slug}`;
  }

  async list(ownerId: string, since?: Date) {
    const rows = await this.db
      .select({ l: trackedLinks, channelTitle: channels.title })
      .from(trackedLinks)
      .leftJoin(channels, eq(channels.id, trackedLinks.channelId))
      .where(and(eq(trackedLinks.ownerId, ownerId), isNull(trackedLinks.archivedAt)))
      .orderBy(desc(trackedLinks.createdAt))
      .limit(100);
    const stats = async (linkId: string, from?: Date) => {
      const where = from
        ? and(eq(linkClicks.linkId, linkId), gte(linkClicks.clickedAt, from))
        : eq(linkClicks.linkId, linkId);
      const [r] = await this.db
        .select({ clicks: count(), unique: countDistinct(linkClicks.visitorHash) })
        .from(linkClicks)
        .where(where);
      return { clicks: r?.clicks ?? 0, unique: r?.unique ?? 0 };
    };
    return Promise.all(
      rows.map(async ({ l, channelTitle }) => ({
        id: l.id,
        title: l.title,
        targetUrl: l.targetUrl,
        shortUrl: this.shortUrl(l.slug),
        isAd: l.isAd,
        channelId: l.channelId,
        channelTitle,
        createdAt: l.createdAt.toISOString(),
        total: await stats(l.id),
        period: since ? await stats(l.id, since) : null,
      })),
    );
  }

  async create(
    ownerId: string,
    input: { title: string; targetUrl: string; channelId?: string | null; isAd?: boolean },
  ) {
    const targetUrl = normalizeTarget(input.targetUrl);
    if (input.channelId) {
      const [c] = await this.db
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.id, input.channelId), eq(channels.ownerId, ownerId)))
        .limit(1);
      if (!c) throw new NotFoundException('Канал не найден');
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = newSlug();
      const [row] = await this.db
        .insert(trackedLinks)
        .values({
          ownerId,
          slug,
          title: input.title.trim(),
          targetUrl,
          channelId: input.channelId ?? null,
          isAd: !!input.isAd,
        })
        .onConflictDoNothing()
        .returning();
      if (row) {
        await this.audit.record({
          action: 'link.created',
          actorUserId: ownerId,
          entityType: 'tracked_link',
          entityId: row.id,
        });
        return { id: row.id, shortUrl: this.shortUrl(row.slug) };
      }
    }
    throw new Error('Не удалось создать уникальную ссылку');
  }

  async archive(ownerId: string, id: string): Promise<void> {
    const r = await this.db
      .update(trackedLinks)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(trackedLinks.id, id), eq(trackedLinks.ownerId, ownerId)))
      .returning({ id: trackedLinks.id });
    if (r.length === 0) throw new NotFoundException('Ссылка не найдена');
  }

  /**
   * Переход по короткой ссылке: адрес назначения (null — ссылки нет). Клик человека
   * записывается с необратимым хэшем посетителя (IP + браузер + соль дня); повтор того
   * же посетителя в течение 30 секунд не считается.
   */
  async resolve(slug: string, ip: string, userAgent: string | undefined): Promise<string | null> {
    if (!/^[A-Za-z0-9]{4,16}$/.test(slug)) return null;
    const [l] = await this.db
      .select()
      .from(trackedLinks)
      .where(eq(trackedLinks.slug, slug))
      .limit(1);
    if (!l || l.archivedAt) return null;
    if (!isBotUserAgent(userAgent)) {
      const day = new Date().toISOString().slice(0, 10);
      const salt = createHmac('sha256', this.config.APP_ENCRYPTION_KEY)
        .update(`links:${day}`)
        .digest();
      const visitorHash = createHmac('sha256', salt)
        .update(`${ip}|${userAgent ?? ''}`)
        .digest('hex')
        .slice(0, 32);
      const [recent] = await this.db
        .select({ n: count() })
        .from(linkClicks)
        .where(
          and(
            eq(linkClicks.linkId, l.id),
            eq(linkClicks.visitorHash, visitorHash),
            gte(linkClicks.clickedAt, new Date(Date.now() - 30_000)),
          ),
        );
      if (!recent?.n) await this.db.insert(linkClicks).values({ linkId: l.id, visitorHash });
    }
    return l.targetUrl;
  }
}
