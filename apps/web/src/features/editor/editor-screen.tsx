'use client';

import {
  TELEGRAM_LIMITS,
  validatePostContent,
  type MediaInfo,
  type PostContent,
  type UrlButton,
} from '@author-studio/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/shared/api';
import { confirmAction } from '@/shared/telegram';
import type { Channel } from '../channels/types';
import type { MediaView, PostView, PublicationView } from '../posts/types';
import { EditorAiPanel } from '../ai/editor-ai-panel';
import { Icon } from '@/shared/ui/icons';
import { btn, Sheet } from '@/shared/ui/kit';
import { useSystemInfo } from '../system/use-system-info';
import { ButtonsPanel } from './buttons-panel';
import { docToMessage, messageToDoc, type PMNode } from './convert';
import { MediaPanel } from './media-panel';
import { PostPreview } from './preview';
import { PublicationsList } from './publications-list';
import { PublishPanel } from './publish-panel';
import { RichEditor } from './rich-editor';
import { takeRestorableBackup, useAutosave, type SaveState } from './use-autosave';

export function EditorScreen() {
  const t = useTranslations('editor');
  const id = useSearchParams().get('id');
  const [post, setPost] = useState<PostView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .get<PostView>(`/posts/${id}`)
      .then((p) => !cancelled && setPost(p))
      .catch(
        (e: unknown) => !cancelled && setError(e instanceof ApiError ? e.message : t('loadFailed')),
      );
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  if (!id) return <p className="text-sm text-text-muted">{t('noId')}</p>;
  if (error)
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  if (!post)
    return (
      <p className="text-sm text-text-muted" aria-busy="true">
        {t('loading')}
      </p>
    );
  return <EditorLoaded key={post.id} initial={post} />;
}

function EditorLoaded({ initial }: { initial: PostView }) {
  const t = useTranslations('editor');
  const router = useRouter();
  const info = useSystemInfo();
  const timezone = info?.timezone ?? 'Europe/Moscow';
  const [restored] = useState(() => takeRestorableBackup(initial));
  const [content, setContent] = useState<PostContent>(restored ?? initial.content);
  const [doc, setDoc] = useState<PMNode>(() =>
    messageToDoc((restored ?? initial.content).text, (restored ?? initial.content).entities),
  );
  const [editorKey, setEditorKey] = useState(0);
  const [mediaLib, setMediaLib] = useState<MediaView[]>(initial.media);
  const [publications, setPublications] = useState<PublicationView[]>(initial.publications);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [sheet, setSheet] = useState<'preview' | 'publish' | null>(null);
  const autosave = useAutosave(initial.id, initial.version);

  useEffect(() => {
    if (restored) autosave.change(restored);
    // Только при первом показе: восстановленные правки отправляются на сервер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: Channel[] }>('/channels')
      .then(
        (r) =>
          !cancelled &&
          setChannels(
            r.items.filter((c) => c.status !== 'detected' && c.status !== 'disconnected'),
          ),
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const mediaById = useMemo(() => new Map(mediaLib.map((m) => [m.id, m])), [mediaLib]);
  const orderedMedia = content.media
    .map((m) => mediaById.get(m.assetId))
    .filter((m): m is MediaView => !!m);
  const infoMap = useMemo(
    () => new Map<string, MediaInfo>(mediaLib.map((m) => [m.id, { kind: m.kind, size: m.size }])),
    [mediaLib],
  );
  const problems = validatePostContent(content, infoMap);
  const limit =
    content.media.length > 0
      ? TELEGRAM_LIMITS.captionMaxLength
      : TELEGRAM_LIMITS.messageTextMaxLength;

  function update(next: PostContent) {
    setContent(next);
    autosave.change(next);
  }

  function onDoc(nextDoc: PMNode) {
    setDoc(nextDoc);
    update({ ...content, ...docToMessage(nextDoc) });
  }

  /** Текст от AI (или возврат прежнего): редактор пересоздаётся из нового содержимого. */
  function applyText(next: Pick<PostContent, 'text' | 'entities'>) {
    setDoc(messageToDoc(next.text, next.entities));
    setEditorKey((k) => k + 1);
    update({ ...content, ...next });
  }

  function onMedia(items: MediaView[]) {
    setMediaLib((lib) => [...lib, ...items.filter((m) => !lib.some((x) => x.id === m.id))]);
    update({ ...content, media: items.map((m) => ({ assetId: m.id })) });
  }

  function loadServerVersion() {
    const server = autosave.acceptServer();
    if (!server) return;
    setContent(server.content);
    setDoc(messageToDoc(server.content.text, server.content.entities));
    setMediaLib((lib) => [...lib, ...server.media.filter((m) => !lib.some((x) => x.id === m.id))]);
    setEditorKey((k) => k + 1);
  }

  const hasActive = publications.some(
    (p) => p.status === 'scheduled' || p.status === 'sending' || p.status === 'ambiguous',
  );

  async function duplicate() {
    await autosave.saveNow();
    const copy = await api.post<PostView>(`/posts/${initial.id}/duplicate`);
    router.push(`/posts/edit/?id=${copy.id}`);
  }

  async function remove() {
    if (!(await confirmAction(t('confirmDelete')))) return;
    await api.del(`/posts/${initial.id}`);
    router.push('/posts/');
  }

  const channelTitle = channels.find((c) => c.status === 'active')?.title ?? t('preview.channel');
  const buttonCount = content.buttons.flat().length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/posts/"
          className="-ml-1 flex items-center gap-0.5 text-sm font-semibold text-accent"
        >
          <Icon name="back" size={18} />
          {t('back')}
        </Link>
        <SaveIndicator state={autosave.state} />
        <details className="relative">
          <summary
            aria-label={t('actions.more')}
            className="grid size-9 cursor-pointer list-none place-items-center rounded-full text-accent [&::-webkit-details-marker]:hidden"
          >
            <Icon name="more" />
          </summary>
          <div className="absolute right-0 z-20 mt-1 flex w-48 flex-col overflow-hidden rounded-[14px] border border-border bg-surface shadow-lg">
            <button
              type="button"
              onClick={() => void duplicate()}
              className="px-4 py-3 text-left text-sm hover:bg-surface-2"
            >
              {t('duplicate')}
            </button>
            {!hasActive && (
              <button
                type="button"
                onClick={() => void remove()}
                className="px-4 py-3 text-left text-sm text-danger hover:bg-surface-2"
              >
                {t('delete')}
              </button>
            )}
          </div>
        </details>
      </header>

      {restored && (
        <p className="rounded-[var(--radius-control)] bg-accent-soft px-3 py-2 text-sm text-accent">
          {t('restored')}
        </p>
      )}

      {autosave.conflict && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-warn-soft px-4 py-3 text-sm"
        >
          <p className="text-warn">{t('conflict.text')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadServerVersion}
              className={`${btn.primary} min-h-10 text-sm`}
            >
              {t('conflict.loadServer')}
            </button>
            <button
              type="button"
              onClick={autosave.keepMine}
              className={`${btn.outline} min-h-10 text-sm`}
            >
              {t('conflict.keepMine')}
            </button>
          </div>
        </div>
      )}

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] md:gap-6">
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            <RichEditor
              key={editorKey}
              initial={doc}
              onChange={onDoc}
              placeholder={t('placeholder')}
            />
            <div className="flex justify-between gap-3 px-4 pb-3 text-xs">
              <label className="flex items-center gap-2 text-text-faint">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-accent)]"
                  checked={content.disableLinkPreview}
                  disabled={content.media.length > 0}
                  onChange={(e) => update({ ...content, disableLinkPreview: e.target.checked })}
                />
                {t('noLinkPreview')}
              </label>
              <span
                className={
                  content.text.length > limit ? 'font-bold text-danger' : 'text-text-faint'
                }
              >
                {content.text.length} / {limit}
              </span>
            </div>
          </div>
          <MediaPanel items={orderedMedia} onChange={onMedia} />
          <EditorAiPanel
            current={{ text: content.text, entities: content.entities }}
            hasMedia={content.media.length > 0}
            onApply={applyText}
          />
          <details
            className="group rounded-[16px] border border-border bg-surface"
            open={buttonCount > 0}
          >
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-semibold [&::-webkit-details-marker]:hidden">
              {t('buttons.title')}
              <span className="flex items-center gap-1 text-sm font-medium text-text-faint">
                {buttonCount
                  ? t('buttons.summaryCount', { n: buttonCount })
                  : t('buttons.summaryNone')}
                <Icon
                  name="chevron"
                  size={16}
                  className="transition-transform group-open:rotate-90"
                />
              </span>
            </summary>
            <div className="px-4 pb-4">
              <ButtonsPanel
                rows={content.buttons}
                onChange={(rows: UrlButton[][]) => update({ ...content, buttons: rows })}
                disabledReason={content.media.length > 1 ? t('buttons.albumDisabled') : undefined}
              />
            </div>
          </details>
          {publications.length > 0 && (
            <PublicationsList
              items={publications}
              timezone={timezone}
              onChange={(p) => setPublications((ps) => ps.map((x) => (x.id === p.id ? p : x)))}
            />
          )}
        </div>
        <div className="hidden md:block">
          <div className="sticky top-6">
            <PostPreview content={content} media={orderedMedia} channelTitle={channelTitle} />
          </div>
        </div>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex gap-2.5 border-t border-border bg-surface/95 px-4 pt-3 backdrop-blur md:left-[248px]">
        <button
          type="button"
          onClick={() => setSheet('preview')}
          className={`${btn.soft} min-h-12 flex-[0.8] md:hidden`}
        >
          {t('actions.preview')}
        </button>
        <button
          type="button"
          onClick={() => setSheet('publish')}
          className={`${btn.primary} min-h-12 flex-1`}
        >
          {t('actions.publish')}
        </button>
      </div>

      <Sheet open={sheet === 'preview'} onClose={() => setSheet(null)} title={t('actions.preview')}>
        <PostPreview content={content} media={orderedMedia} channelTitle={channelTitle} />
      </Sheet>
      <Sheet
        open={sheet === 'publish'}
        onClose={() => setSheet(null)}
        title={t('publish.sheetTitle')}
      >
        <div className="flex flex-col gap-3">
          <PostPreview content={content} media={orderedMedia} channelTitle={channelTitle} compact />
          <PublishPanel
            postId={initial.id}
            channels={channels}
            timezone={timezone}
            problems={problems}
            saveNow={autosave.saveNow}
            onPublished={async (items) => {
              setPublications((ps) => [...ps, ...items]);
              setSheet(null);
              await autosave.saveNow();
              router.push(`/posts/view/?id=${initial.id}`);
            }}
          />
        </div>
      </Sheet>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const t = useTranslations('editor.save');
  const tone =
    state === 'saved'
      ? 'text-text-faint'
      : state === 'offline' || state === 'error' || state === 'conflict'
        ? 'text-warn'
        : 'text-text-muted';
  return (
    <span className={`text-xs ${tone}`} aria-live="polite">
      {t(state)}
    </span>
  );
}
