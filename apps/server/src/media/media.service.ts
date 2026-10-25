import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  type OnModuleInit,
} from '@nestjs/common';
import { TELEGRAM_LIMITS, type MediaInfo } from '@author-studio/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { DB, type Database } from '../database/database.module.js';
import { mediaAssets } from '../database/schema.js';
import { sniffMedia } from './sniff.js';

export type MediaRow = typeof mediaAssets.$inferSelect;

export interface MediaView {
  id: string;
  kind: 'photo' | 'video';
  mime: string;
  size: number;
  originalName: string | null;
}

export const toMediaView = (m: MediaRow): MediaView => ({
  id: m.id,
  kind: m.kind,
  mime: m.mime,
  size: m.size,
  originalName: m.originalName,
});

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

@Injectable()
export class MediaService implements OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {}

  get dir(): string {
    return this.config.MEDIA_DIR;
  }

  get uploadDir(): string {
    return path.join(this.dir, 'incoming');
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.uploadDir, { recursive: true });
  }

  pathOf(row: Pick<MediaRow, 'storageKey'>): string {
    // storageKey формируется сервером (uuid.ext); проверка — защита от обхода каталога.
    const full = path.resolve(this.dir, row.storageKey);
    if (!full.startsWith(path.resolve(this.dir) + path.sep))
      throw new Error('Недопустимый путь медиафайла');
    return full;
  }

  /** Приём загруженного файла: проверка сигнатуры и размера, перенос в хранилище. */
  async accept(
    ownerId: string,
    tmpPath: string,
    originalName: string | undefined,
    size: number,
  ): Promise<MediaView> {
    try {
      const fh = await open(tmpPath, 'r');
      const head = Buffer.alloc(16);
      await fh.read(head, 0, 16, 0);
      await fh.close();
      const sniff = sniffMedia(head);
      if (!sniff) {
        throw new BadRequestException('Поддерживаются фото JPEG, PNG, WebP и видео MP4, MOV');
      }
      if (sniff.kind === 'photo' && size > TELEGRAM_LIMITS.photoUploadMaxBytes) {
        throw new PayloadTooLargeException('Фото больше 10 МБ — Telegram его не примет');
      }
      const id = randomUUID();
      const storageKey = `${id}.${sniff.ext}`;
      const sha256 = await hashFile(tmpPath);
      await rename(tmpPath, path.join(this.dir, storageKey));
      const [row] = await this.db
        .insert(mediaAssets)
        .values({
          id,
          ownerId,
          kind: sniff.kind,
          mime: sniff.mime,
          size,
          sha256,
          storageKey,
          originalName: originalName ? originalName.slice(0, 200) : null,
        })
        .returning();
      return toMediaView(row!);
    } finally {
      await rm(tmpPath, { force: true });
    }
  }

  async getOwned(ownerId: string, id: string): Promise<MediaRow> {
    const [row] = await this.db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.ownerId, ownerId)))
      .limit(1);
    if (!row) throw new NotFoundException('Медиафайл не найден');
    return row;
  }

  async findMany(ownerId: string, ids: string[]): Promise<MediaRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.ownerId, ownerId), inArray(mediaAssets.id, ids)));
  }

  static infoMap(rows: MediaRow[]): Map<string, MediaInfo> {
    return new Map(rows.map((r) => [r.id, { kind: r.kind, size: r.size }]));
  }

  /**
   * Миниатюра фото для списков (WebP до 480 px), создаётся при первом запросе и
   * хранится рядом с оригиналом. sharp загружается лениво: если нативная библиотека
   * недоступна, вернётся null, и интерфейс покажет заглушку вместо падения API.
   */
  async thumbnail(row: MediaRow): Promise<string | null> {
    if (row.kind !== 'photo') return null;
    const dir = path.join(this.dir, 'thumbs');
    const file = path.join(dir, `${row.id}.webp`);
    try {
      await access(file);
      return file;
    } catch {
      // ещё не создана
    }
    try {
      const { default: sharp } = await import('sharp');
      await mkdir(dir, { recursive: true });
      const tmp = `${file}.${randomUUID()}.tmp`;
      await sharp(this.pathOf(row), { failOn: 'none' })
        .rotate()
        .resize(480, 480, { fit: 'cover', withoutEnlargement: true })
        .webp({ quality: 72 })
        .toFile(tmp);
      await rename(tmp, file);
      return file;
    } catch {
      return null;
    }
  }

  async rememberTelegramFileId(id: string, fileId: string): Promise<void> {
    await this.db.update(mediaAssets).set({ telegramFileId: fileId }).where(eq(mediaAssets.id, id));
  }
}
