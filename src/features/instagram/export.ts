import { decodeUtf8, type ZipEntry } from './zip';

// Reads the posts in an Instagram download ("Download your information", JSON
// format). Posts are listed in posts_1.json, posts_2.json, ... as
//   [{ media: [{ uri: "media/posts/202305/123.jpg", creation_timestamp, title }], title?, creation_timestamp? }]
// where a carousel has several media and the caption and date sit on the post,
// and a single photo has them on its one media item.

export type ExportPost = {
  /** Stable id for this post within the person's downloads. */
  key: string;
  caption: string | null;
  takenAt: string;
  /** Zip entry names of the post's photos, in order (at most 10). */
  photos: string[];
};

export type ExportContents = { posts: ExportPost[]; videosSkipped: number };

const PHOTO = /\.(jpe?g|png|webp|heic|heif)$/i;
const VIDEO = /\.(mp4|mov|m4v)$/i;
const MAX_CAPTION = 2200;
const MAX_PHOTOS = 10;

export class ExportError extends Error {}

/** The posts_N.json entries, or an error explaining what's wrong with the file. */
export function postFiles(entries: ZipEntry[]): ZipEntry[] {
  const json = entries.filter((e) => /(^|\/)posts_\d+\.json$/.test(e.name) && !/(^|\/)(stories|reels|archived)/.test(e.name));
  if (json.length) return json.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (entries.some((e) => /(^|\/)posts_\d+\.html$/.test(e.name))) throw new ExportError('export_is_html');
  throw new ExportError('export_no_posts');
}

/** Meta writes text as one \u00XX escape per UTF-8 byte; turn that back into real characters. */
export function fixMetaText(s: string): string {
  if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
  const fixed = decodeUtf8(bytes);
  return fixed.includes('�') ? s : fixed;
}

// The part of a path from "media/" on, so files resolve whatever folder the zip was made in.
const mediaKey = (path: string) => {
  const i = path.indexOf('media/');
  return i >= 0 ? path.slice(i) : path;
};

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

type RawMedia = { uri?: unknown; creation_timestamp?: unknown; title?: unknown };
type RawPost = { media?: unknown; title?: unknown; creation_timestamp?: unknown };

export function parsePosts(jsonFiles: string[], entries: ZipEntry[]): ExportContents {
  const byMedia = new Map(entries.map((e) => [mediaKey(e.name), e.name]));
  const seen = new Set<string>();
  const posts: ExportPost[] = [];
  let videosSkipped = 0;
  for (const text of jsonFiles) {
    let list: unknown;
    try {
      list = JSON.parse(text);
    } catch {
      throw new ExportError('export_unreadable');
    }
    if (!Array.isArray(list)) continue;
    for (const raw of list as RawPost[]) {
      const media = (Array.isArray(raw?.media) ? raw.media : []) as RawMedia[];
      const uris = media.map((m) => (typeof m?.uri === 'string' ? m.uri : '')).filter(Boolean);
      const photos = uris.filter((u) => PHOTO.test(u)).map((u) => byMedia.get(mediaKey(u))).filter((n): n is string => !!n);
      if (!photos.length) {
        if (uris.some((u) => VIDEO.test(u))) videosSkipped++;
        continue;
      }
      const ts = Number(raw.creation_timestamp ?? media[0]?.creation_timestamp);
      if (!Number.isFinite(ts) || ts <= 0) continue;
      const title = typeof raw.title === 'string' ? raw.title : typeof media[0]?.title === 'string' ? (media[0].title as string) : '';
      const caption = fixMetaText(title).trim().slice(0, MAX_CAPTION) || null;
      const key = `ig:${Math.floor(ts)}:${hash(mediaKey(uris[0]))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      posts.push({ key, caption, takenAt: new Date(ts * 1000).toISOString(), photos: photos.slice(0, MAX_PHOTOS) });
    }
  }
  posts.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  return { posts, videosSkipped };
}
