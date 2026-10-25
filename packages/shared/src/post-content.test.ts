import { describe, expect, it } from 'vitest';
import {
  EMPTY_POST_CONTENT,
  summarizeContent,
  validatePostContent,
  type MediaInfo,
  type PostContent,
} from './post-content';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const media = new Map<string, MediaInfo>([
  [A, { kind: 'photo', size: 1_000_000 }],
  [B, { kind: 'video', size: 60 * 1024 * 1024 }],
]);
const post = (p: Partial<PostContent>): PostContent => ({ ...EMPTY_POST_CONTENT, ...p });
const messages = (c: PostContent) => validatePostContent(c, media).map((p) => p.message);

describe('validatePostContent', () => {
  it('пустая публикация недопустима', () => {
    expect(messages(post({}))).toEqual(['Добавьте текст или медиафайл']);
  });

  it('текст до 4096 символов допустим, длиннее — нет', () => {
    expect(messages(post({ text: 'а'.repeat(4096) }))).toEqual([]);
    expect(messages(post({ text: 'а'.repeat(4097) }))[0]).toContain('4096');
  });

  it('с медиа действует лимит подписи 1024', () => {
    const c = post({ text: 'а'.repeat(1025), media: [{ assetId: A }] });
    expect(messages(c)[0]).toContain('Подпись к медиа длиннее 1024');
  });

  it('эмодзи считаются в единицах UTF-16, как в Telegram', () => {
    expect(messages(post({ text: '😀'.repeat(2048) }))).toEqual([]);
    expect(messages(post({ text: '😀'.repeat(2049) }))).toHaveLength(1);
  });

  it('больше 10 медиа, повтор файла и неизвестный файл — ошибки', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      assetId: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
    }));
    expect(messages(post({ media: many })).join()).toContain('не больше 10');
    expect(messages(post({ media: [{ assetId: A }, { assetId: A }] })).join()).toContain('дважды');
    expect(
      messages(post({ media: [{ assetId: '00000000-0000-4000-8000-0000000000ff' }] }))[0],
    ).toContain('не найден');
  });

  it('видео больше 50 МБ не загрузить', () => {
    expect(messages(post({ media: [{ assetId: B }] })).join()).toContain('50 МБ');
  });

  it('кнопки: нельзя к альбому, проверка текста и ссылки', () => {
    const btn = [[{ text: 'Сайт', url: 'https://example.ru' }]];
    expect(messages(post({ text: 'x', buttons: btn }))).toEqual([]);
    expect(
      messages(
        post({ media: [{ assetId: A }, { assetId: A.replace('a', 'c') }], buttons: btn }),
      ).join(),
    ).toContain('альбому');
    expect(
      messages(post({ text: 'x', buttons: [[{ text: '', url: 'https://e.ru' }]] })).join(),
    ).toContain('Текст кнопки');
    expect(
      messages(post({ text: 'x', buttons: [[{ text: 'a', url: 'javascript:alert(1)' }]] })).join(),
    ).toContain('Неверная ссылка');
  });

  it('форматирование за пределами текста и ссылка без адреса — ошибки', () => {
    expect(
      messages(post({ text: 'abc', entities: [{ type: 'bold', offset: 2, length: 5 }] })).join(),
    ).toContain('за пределы');
    expect(
      messages(
        post({
          text: 'abc',
          entities: [{ type: 'text_link', offset: 0, length: 3, url: 'ftp://x' }],
        }),
      ).join(),
    ).toContain('неверный адрес');
  });
});

describe('summarizeContent', () => {
  it('первая непустая строка, обрезка, медиа без текста', () => {
    expect(summarizeContent(post({ text: '\n\nПривет\nмир' }))).toBe('Привет');
    expect(summarizeContent(post({ text: 'а'.repeat(100) }), 10)).toBe('ааааааааа…');
    expect(summarizeContent(post({ media: [{ assetId: A }, { assetId: B }] }))).toBe(
      'Альбом: 2 файлов',
    );
  });
});
