import { strToU8, zipSync } from 'fflate';
import { ExportError, fixMetaText, parsePosts, postFiles } from '@/features/instagram/export';
import { decodeUtf8, listEntries, readEntry, type RandomAccess } from '@/features/instagram/zip';

const mem = (b: Uint8Array): RandomAccess => ({ size: b.length, read: async (o, l) => b.slice(o, o + l) });
const jpg = (n: number) => new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9]);

// Meta's own escaping: one \u00XX per UTF-8 byte.
const metaEscape = (s: string) => String.fromCharCode(...strToU8(s));

const posts = [
  { media: [{ uri: 'media/posts/202305/1.jpg', creation_timestamp: 1684000000, title: metaEscape('Café ☕ #weekend') }] },
  {
    title: 'Carousel',
    creation_timestamp: 1690000000,
    media: [
      { uri: 'media/posts/202307/2.jpg', creation_timestamp: 1690000000, title: '' },
      { uri: 'media/posts/202307/3.mp4', creation_timestamp: 1690000000, title: '' },
      { uri: 'media/posts/202307/4.heic', creation_timestamp: 1690000000, title: '' },
    ],
  },
  { media: [{ uri: 'media/posts/202308/5.mp4', creation_timestamp: 1691000000, title: 'Just a video' }] },
];

function exportZip() {
  const root = 'instagram-rania-20261116/';
  return zipSync({
    [`${root}your_instagram_activity/media/posts_1.json`]: strToU8(JSON.stringify(posts)),
    [`${root}media/posts/202305/1.jpg`]: [jpg(1), { level: 0 }],
    [`${root}media/posts/202307/2.jpg`]: [jpg(2), { level: 0 }],
    [`${root}media/posts/202307/3.mp4`]: [new Uint8Array(8), { level: 0 }],
    [`${root}media/posts/202307/4.heic`]: [new Uint8Array([7, 7, 7]), { level: 0 }],
    [`${root}media/posts/202308/5.mp4`]: [new Uint8Array(8), { level: 0 }],
    [`${root}your_instagram_activity/media/stories.json`]: strToU8('[]'),
  });
}

describe('zip reader', () => {
  it('lists entries and reads stored and deflated files', async () => {
    const src = mem(exportZip());
    const entries = await listEntries(src);
    expect(entries).toHaveLength(7);
    const photo = entries.find((e) => e.name.endsWith('1.jpg'))!;
    expect(await readEntry(src, photo)).toEqual(jpg(1));
    const json = entries.find((e) => e.name.endsWith('posts_1.json'))!;
    expect(json.method).toBe(8);
    expect(JSON.parse(decodeUtf8(await readEntry(src, json)))).toHaveLength(3);
  });

  it('rejects files that are not zips', async () => {
    await expect(listEntries(mem(strToU8('hello, not a zip at all')))).rejects.toThrow('not_a_zip');
  });
});

describe('Instagram download', () => {
  it('finds photo posts with captions, dates and carousel photos, skipping videos', async () => {
    const src = mem(exportZip());
    const entries = await listEntries(src);
    const files = postFiles(entries);
    const texts = await Promise.all(files.map(async (f) => decodeUtf8(await readEntry(src, f))));
    const { posts: found, videosSkipped } = parsePosts(texts, entries);
    expect(videosSkipped).toBe(1);
    expect(found.map((p) => p.caption)).toEqual(['Carousel', 'Café ☕ #weekend']);
    expect(found[0].photos.map((n) => n.split('/').pop())).toEqual(['2.jpg', '4.heic']);
    expect(found[1].takenAt).toBe('2023-05-13T17:46:40.000Z');
    expect(found[1].key).toMatch(/^ig:1684000000:[a-z0-9]+$/);
    // The same download gives the same keys, so imported posts are recognised.
    expect(parsePosts(texts, entries).posts.map((p) => p.key)).toEqual(found.map((p) => p.key));
  });

  it('explains a download in HTML format or without posts', () => {
    const e = (name: string) => ({ name, method: 0, compressedSize: 0, size: 0, localOffset: 0 });
    expect(() => postFiles([e('x/your_instagram_activity/media/posts_1.html')])).toThrow(new ExportError('export_is_html'));
    expect(() => postFiles([e('x/messages/inbox.json')])).toThrow(new ExportError('export_no_posts'));
  });

  it('repairs Meta-escaped text and leaves normal text alone', () => {
    expect(fixMetaText(metaEscape('Ünïcödé 😀'))).toBe('Ünïcödé 😀');
    expect(fixMetaText('Plain caption')).toBe('Plain caption');
    expect(fixMetaText('Already fine: café ☕')).toBe('Already fine: café ☕');
  });
});
