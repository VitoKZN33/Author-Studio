import { Inject, Injectable } from '@nestjs/common';
import type { PostContent } from '@author-studio/shared';
import { InputFile } from 'grammy';
import type { InlineKeyboardMarkup, Message, MessageEntity } from 'grammy/types';
import { MediaService, type MediaRow } from '../media/media.service.js';
import { TELEGRAM_CLIENT } from '../telegram/telegram.module.js';
import type { TelegramClient } from '../telegram/telegram-client.js';

export interface SendResult {
  messageIds: number[];
}

function toTelegramEntities(content: PostContent): MessageEntity[] {
  return content.entities.map((e) =>
    e.type === 'text_link'
      ? { type: 'text_link', offset: e.offset, length: e.length, url: e.url ?? '' }
      : ({ type: e.type, offset: e.offset, length: e.length } as MessageEntity),
  );
}

function toKeyboard(content: PostContent): InlineKeyboardMarkup | undefined {
  const rows = content.buttons.filter((r) => r.length > 0);
  if (rows.length === 0) return undefined;
  return { inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, url: b.url }))) };
}

/**
 * Преобразует содержимое публикации в вызов Bot API:
 * текст → sendMessage; один файл → sendPhoto/sendVideo; 2–10 файлов → sendMediaGroup.
 * Уже загруженные в Telegram файлы отправляются по file_id.
 */
@Injectable()
export class TelegramPublisher {
  constructor(
    @Inject(TELEGRAM_CLIENT) private readonly telegram: TelegramClient | null,
    private readonly media: MediaService,
  ) {}

  private client(): TelegramClient {
    if (!this.telegram) throw new Error('Бот не настроен: задайте TELEGRAM_BOT_TOKEN');
    return this.telegram;
  }

  private file(row: MediaRow): string | InputFile {
    return row.telegramFileId ?? new InputFile(this.media.pathOf(row));
  }

  private async rememberFileIds(rows: MediaRow[], messages: Message[]): Promise<void> {
    await Promise.all(
      rows.map(async (row, i) => {
        if (row.telegramFileId) return;
        const m = messages[i];
        const fileId = m?.photo?.at(-1)?.file_id ?? m?.video?.file_id;
        if (fileId) await this.media.rememberTelegramFileId(row.id, fileId);
      }),
    );
  }

  /** mediaRows — в порядке content.media. Ошибки Bot API — TelegramApiError. */
  async send(chatId: number, content: PostContent, mediaRows: MediaRow[]): Promise<SendResult> {
    const tg = this.client();
    const entities = toTelegramEntities(content);
    const reply_markup = toKeyboard(content);
    const text = content.text;

    if (mediaRows.length === 0) {
      const m = await tg.call('sendMessage', (api) =>
        api.sendMessage(chatId, text, {
          entities,
          link_preview_options: { is_disabled: content.disableLinkPreview },
          ...(reply_markup ? { reply_markup } : {}),
        }),
      );
      return { messageIds: [m.message_id] };
    }

    if (mediaRows.length === 1) {
      const row = mediaRows[0]!;
      const common = {
        ...(text ? { caption: text, caption_entities: entities } : {}),
        ...(reply_markup ? { reply_markup } : {}),
      };
      const m =
        row.kind === 'photo'
          ? await tg.call('sendPhoto', (api) => api.sendPhoto(chatId, this.file(row), common))
          : await tg.call('sendVideo', (api) =>
              api.sendVideo(chatId, this.file(row), { ...common, supports_streaming: true }),
            );
      await this.rememberFileIds(mediaRows, [m]);
      return { messageIds: [m.message_id] };
    }

    const group: Parameters<TelegramClient['api']['sendMediaGroup']>[1] = mediaRows.map(
      (row, i) => {
        const caption = i === 0 && text ? { caption: text, caption_entities: entities } : {};
        return row.kind === 'photo'
          ? { type: 'photo', media: this.file(row), ...caption }
          : { type: 'video', media: this.file(row), supports_streaming: true, ...caption };
      },
    );
    const messages = await tg.call('sendMediaGroup', (api) => api.sendMediaGroup(chatId, group));
    await this.rememberFileIds(mediaRows, messages);
    return { messageIds: messages.map((m) => m.message_id) };
  }
}
