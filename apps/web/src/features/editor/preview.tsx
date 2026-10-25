'use client';

import type { MessageEntity, PostContent } from '@author-studio/shared';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { MediaThumb } from './media-panel';
import type { MediaView } from '../posts/types';

const SAFE_URL = /^(https?:\/\/|tg:\/\/)/i;

/** Текст с entities → React-элементы (без innerHTML). */
export function renderEntities(text: string, entities: MessageEntity[]): ReactNode[] {
  const cuts = new Set([0, text.length]);
  for (const e of entities) {
    cuts.add(e.offset);
    cuts.add(Math.min(e.offset + e.length, text.length));
  }
  const points = [...cuts].filter((p) => p <= text.length).sort((a, b) => a - b);
  const out: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    let node: ReactNode = text.slice(a, b);
    const active = entities.filter((e) => e.offset <= a && e.offset + e.length >= b);
    for (const e of active) {
      switch (e.type) {
        case 'bold':
          node = <strong className="font-semibold">{node}</strong>;
          break;
        case 'italic':
          node = <em>{node}</em>;
          break;
        case 'underline':
          node = <u>{node}</u>;
          break;
        case 'strikethrough':
          node = <s>{node}</s>;
          break;
        case 'code':
        case 'pre':
          node = <code className="rounded bg-black/25 px-1 font-mono text-[0.9em]">{node}</code>;
          break;
        case 'spoiler':
          node = <span className="tg-spoiler">{node}</span>;
          break;
        case 'blockquote':
          node = <span className="tg-quote">{node}</span>;
          break;
        case 'text_link':
          node =
            e.url && SAFE_URL.test(e.url) ? (
              <a
                href={e.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#7ab8ff] underline-offset-2 hover:underline"
              >
                {node}
              </a>
            ) : (
              node
            );
          break;
      }
    }
    out.push(<span key={a}>{node}</span>);
  }
  return out;
}

/** Приблизительный вид поста в канале Telegram. */
export function PostPreview({
  content,
  media,
  channelTitle,
  compact = false,
}: {
  content: PostContent;
  media: MediaView[];
  channelTitle: string;
  /** Уменьшенный вид (в окне публикации): медиа ниже, текст — до 4 строк. */
  compact?: boolean;
}) {
  const t = useTranslations('editor.preview');
  const byId = new Map(media.map((m) => [m.id, m]));
  const items = content.media.map((m) => byId.get(m.assetId)).filter((m): m is MediaView => !!m);
  const buttons = content.buttons.filter((r) => r.length > 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-[var(--radius-card)] bg-[#0e1621] p-3">
        <div className="max-w-[420px] overflow-hidden rounded-2xl rounded-bl-md bg-[#182533] shadow-sm">
          {items.length > 0 && (
            <div
              className={`grid gap-0.5 ${items.length === 1 ? 'grid-cols-1' : items.length === 2 || items.length === 4 ? 'grid-cols-2' : 'grid-cols-3'}`}
            >
              {items.map((m) => (
                <MediaThumb
                  key={m.id}
                  media={m}
                  className={
                    items.length === 1
                      ? compact
                        ? 'max-h-40 w-full'
                        : 'max-h-80 w-full'
                      : 'aspect-square w-full'
                  }
                />
              ))}
            </div>
          )}
          <div className="px-3 pt-2 pb-1.5">
            <div className="text-[13px] font-medium text-[#71baf7]">{channelTitle}</div>
            {content.text && (
              <p
                className={`mt-0.5 text-[15px] leading-snug break-words whitespace-pre-wrap text-[#f5f5f5] ${compact ? 'line-clamp-4' : ''}`}
              >
                {renderEntities(content.text, content.entities)}
              </p>
            )}
          </div>
        </div>
        {buttons.length > 0 && (
          <div className="mt-1 flex max-w-[420px] flex-col gap-1">
            {buttons.map((row, i) => (
              <div key={i} className="flex gap-1">
                {row.map((b, j) => (
                  <span
                    key={j}
                    className="flex-1 truncate rounded-lg bg-[#2b5278]/60 px-2 py-2 text-center text-sm text-white"
                  >
                    {b.text || '…'}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {!compact && <p className="text-xs text-text-faint">{t('approximate')}</p>}
    </div>
  );
}
