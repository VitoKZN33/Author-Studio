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
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
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

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/posts/" className="text-sm text-text-muted hover:text-text">
          ← {t('back')}
        </Link>
        <SaveIndicator state={autosave.state} />
      </header>

      {restored && (
        <p className="rounded-[var(--radius-control)] bg-accent-soft px-3 py-2 text-sm text-accent">
          {t('restored')}
        </p>
      )}

      {autosave.conflict && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-warn/40 bg-warn-soft px-4 py-3 text-sm"
        >
          <p className="text-warn">{t('conflict.text')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadServerVersion}
              className="min-h-10 rounded-[var(--radius-control)] bg-accent px-3 font-medium text-bg"
            >
              {t('conflict.loadServer')}
            </button>
            <button
              type="button"
              onClick={autosave.keepMine}
              className="min-h-10 rounded-[var(--radius-control)] border border-border-strong px-3 text-text-muted"
            >
              {t('conflict.keepMine')}
            </button>
          </div>
        </div>
      )}

      <div
        className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-surface-2 p-1 md:hidden"
        role="tablist"
      >
        {(['edit', 'preview'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`min-h-9 rounded-[6px] text-sm ${tab === k ? 'bg-surface text-text' : 'text-text-muted'}`}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className={`flex flex-col gap-5 ${tab === 'edit' ? '' : 'hidden md:flex'}`}>
          <div className="flex flex-col gap-1.5">
            <RichEditor
              key={editorKey}
              initial={doc}
              onChange={onDoc}
              placeholder={t('placeholder')}
            />
            <div className="flex justify-between text-xs">
              <label className="flex items-center gap-2 text-text-muted">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-accent)]"
                  checked={content.disableLinkPreview}
                  disabled={content.media.length > 0}
                  onChange={(e) => update({ ...content, disableLinkPreview: e.target.checked })}
                />
                {t('noLinkPreview')}
              </label>
              <span className={content.text.length > limit ? 'text-danger' : 'text-text-faint'}>
                {content.text.length} / {limit}
              </span>
            </div>
          </div>
          <EditorAiPanel
            current={{ text: content.text, entities: content.entities }}
            hasMedia={content.media.length > 0}
            onApply={applyText}
          />
          <MediaPanel items={orderedMedia} onChange={onMedia} />
          <ButtonsPanel
            rows={content.buttons}
            onChange={(rows: UrlButton[][]) => update({ ...content, buttons: rows })}
            disabledReason={content.media.length > 1 ? t('buttons.albumDisabled') : undefined}
          />
        </div>

        <div className={`flex flex-col gap-5 ${tab === 'preview' ? '' : 'hidden md:flex'}`}>
          <PostPreview content={content} media={orderedMedia} channelTitle={channelTitle} />
          <PublishPanel
            postId={initial.id}
            channels={channels}
            timezone={timezone}
            problems={problems}
            saveNow={autosave.saveNow}
            onPublished={(items) => setPublications((ps) => [...ps, ...items])}
          />
          <PublicationsList
            items={publications}
            timezone={timezone}
            onChange={(p) => setPublications((ps) => ps.map((x) => (x.id === p.id ? p : x)))}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void duplicate()}
              className="min-h-10 rounded-[var(--radius-control)] border border-border-strong px-3.5 text-sm text-text-muted hover:text-text"
            >
              {t('duplicate')}
            </button>
            {!hasActive && (
              <button
                type="button"
                onClick={() => void remove()}
                className="min-h-10 rounded-[var(--radius-control)] border border-border-strong px-3.5 text-sm text-danger"
              >
                {t('delete')}
              </button>
            )}
          </div>
        </div>
      </div>
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
