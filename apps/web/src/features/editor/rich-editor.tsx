'use client';

import { Mark, mergeAttributes, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { PMNode } from './convert';

/** Спойлер Telegram — отдельная отметка редактора. */
const Spoiler = Mark.create({
  name: 'spoiler',
  parseHTML: () => [{ tag: 'span[data-spoiler]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, { 'data-spoiler': '', class: 'tg-spoiler' }),
    0,
  ],
});

export const EDITOR_EXTENSIONS = [
  StarterKit.configure({
    heading: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    horizontalRule: false,
    link: {
      openOnClick: false,
      autolink: false,
      protocols: ['tg'],
      HTMLAttributes: { rel: 'noopener noreferrer', target: null },
    },
  }),
  Spoiler,
];

interface Props {
  initial: PMNode;
  onChange: (doc: PMNode) => void;
  placeholder: string;
}

export function RichEditor({ initial, onChange, placeholder }: Props) {
  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: initial as JSONContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'tg-editor min-h-40 px-3.5 py-3 text-[15px] leading-relaxed focus:outline-none',
        'aria-label': placeholder,
        'aria-multiline': 'true',
        role: 'textbox',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as PMNode),
  });

  return (
    <div>
      {editor && <Toolbar editor={editor} />}
      <div className="relative">
        <EditorContent editor={editor} />
        {editor?.isEmpty && (
          <p className="pointer-events-none absolute top-3 left-3.5 text-[15px] text-text-faint">
            {placeholder}
          </p>
        )}
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const t = useTranslations('editor.toolbar');
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      spoiler: e.isActive('spoiler'),
      link: e.isActive('link'),
      quote: e.isActive('blockquote'),
      href: (e.getAttributes('link').href as string | undefined) ?? '',
    }),
  });

  function openLink() {
    setUrl(state.href || 'https://');
    setLinkOpen((v) => !v);
  }

  function applyLink(e: FormEvent) {
    e.preventDefault();
    const value = url.trim();
    if (!value || value === 'https://')
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
    setLinkOpen(false);
  }

  const btn = (key: string, active: boolean, run: () => void, label: ReactNode) => (
    <button
      key={key}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      aria-pressed={active}
      aria-label={t(key)}
      title={t(key)}
      className={`grid h-9 min-w-9 place-items-center rounded-[var(--radius-control)] px-2 text-sm ${
        active ? 'bg-accent-soft text-accent' : 'text-text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="border-b border-border">
      <div className="flex flex-wrap gap-0.5 p-1.5" role="toolbar" aria-label={t('label')}>
        {btn('bold', state.bold, () => editor.chain().focus().toggleBold().run(), <b>Ж</b>)}
        {btn('italic', state.italic, () => editor.chain().focus().toggleItalic().run(), <i>К</i>)}
        {btn(
          'underline',
          state.underline,
          () => editor.chain().focus().toggleUnderline().run(),
          <u>Ч</u>,
        )}
        {btn('strike', state.strike, () => editor.chain().focus().toggleStrike().run(), <s>З</s>)}
        {btn(
          'code',
          state.code,
          () => editor.chain().focus().toggleCode().run(),
          <code className="text-xs">{'</>'}</code>,
        )}
        {btn(
          'spoiler',
          state.spoiler,
          () => editor.chain().focus().toggleMark('spoiler').run(),
          <span className="tg-spoiler px-1">ab</span>,
        )}
        {btn(
          'link',
          state.link || linkOpen,
          openLink,
          <span className="underline underline-offset-2">🔗</span>,
        )}
        {btn(
          'quote',
          state.quote,
          () => editor.chain().focus().toggleBlockquote().run(),
          <span className="text-lg leading-none">❝</span>,
        )}
      </div>
      {linkOpen && (
        <form onSubmit={applyLink} className="flex gap-2 border-t border-border p-2">
          <input
            autoFocus
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label={t('linkUrl')}
            className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            className="min-h-10 rounded-[var(--radius-control)] bg-accent px-3 text-sm font-medium text-on-accent"
          >
            {t('linkApply')}
          </button>
        </form>
      )}
    </div>
  );
}
