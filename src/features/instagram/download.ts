import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { publishPost, uploadPhoto } from '@/features/posts/api';
import { check } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { ExportError, parsePosts, postFiles, type ExportPost } from './export';
import { decodeUtf8, listEntries, readEntry, type RandomAccess, type ZipEntry } from './zip';

// Import from an Instagram download, on the phone: open the zip, list the
// photo posts, and publish the ones the person picks through publish-post.

export const INSTAGRAM_DOWNLOAD_URL = 'https://accountscenter.instagram.com/info_and_permissions/dyi/';
export const MAX_IMPORT = 10;
const MAX_EDGE = 2048;

export type OpenDownload = {
  posts: ExportPost[];
  videosSkipped: number;
  /** Writes a post's photo to the cache and returns its file URI. */
  photoUri(name: string): Promise<string>;
  close(): void;
};

function fileAccess(file: File): RandomAccess & { close(): void } {
  const handle = file.open(FileMode.ReadOnly);
  // Reads on one handle must not overlap: each seeks, then reads.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    size: handle.size ?? 0,
    read(offset, length) {
      const run = queue.then(async () => {
        handle.offset = offset;
        const out = new Uint8Array(length);
        let got = 0;
        while (got < length) {
          const part = await handle.readBytes(Math.min(length - got, 32 * 1024 * 1024));
          if (!part.length) break;
          out.set(part, got);
          got += part.length;
        }
        return got === length ? out : out.subarray(0, got);
      });
      queue = run.catch(() => undefined);
      return run;
    },
    close: () => handle.close(),
  };
}

/** Asks for the download file. Returns null if the person cancels. */
export async function pickDownload(): Promise<File | null> {
  const r = await File.pickFileAsync({
    mimeTypes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
  });
  return r.canceled ? null : r.result;
}

export async function openDownload(file: File): Promise<OpenDownload> {
  const src = fileAccess(file);
  try {
    let entries: ZipEntry[];
    try {
      entries = await listEntries(src);
    } catch {
      throw new ExportError('export_not_zip');
    }
    const texts: string[] = [];
    for (const f of postFiles(entries)) texts.push(decodeUtf8(await readEntry(src, f)));
    const { posts, videosSkipped } = parsePosts(texts, entries);
    const byName = new Map(entries.map((e) => [e.name, e]));
    const dir = new Directory(Paths.cache, 'instagram-download');
    dir.create({ idempotent: true, intermediates: true });
    return {
      posts,
      videosSkipped,
      async photoUri(name) {
        const entry = byName.get(name);
        if (!entry) throw new ExportError('export_unreadable');
        const out = new File(dir, `${entry.localOffset}-${name.split('/').pop()}`);
        if (!out.exists) {
          out.create({ overwrite: true });
          await out.write(await readEntry(src, entry));
        }
        return out.uri;
      },
      close() {
        src.close();
        try {
          dir.delete();
        } catch {
          // The cache is cleared by the system eventually anyway.
        }
      },
    };
  } catch (e) {
    src.close();
    throw e;
  }
}

/** Which of these posts are already on Locale. */
export async function importedKeys(keys: string[]): Promise<Set<string>> {
  const done = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const { data, error } = await supabase.rpc('my_imported_keys', { p_keys: keys.slice(i, i + 500) });
    check({ error });
    for (const k of (data as string[] | null) ?? []) done.add(k);
  }
  return done;
}

// Any format the phone can decode (JPEG, PNG, WebP, HEIC) becomes a JPEG of at
// most 2048 px; re-rendering also drops metadata (the server strips it again).
async function toJpeg(uri: string): Promise<string> {
  let image = await ImageManipulator.manipulate(uri).renderAsync();
  if (Math.max(image.width, image.height) > MAX_EDGE) {
    image = await ImageManipulator.manipulate(uri)
      .resize(image.width >= image.height ? { width: MAX_EDGE } : { height: MAX_EDGE })
      .renderAsync();
  }
  return (await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 })).uri;
}

export async function importPost(userId: string, download: OpenDownload, post: ExportPost): Promise<string> {
  const uploads: string[] = [];
  for (const name of post.photos) uploads.push(await uploadPhoto(userId, await toJpeg(await download.photoUri(name))));
  return publishPost({
    uploads,
    caption: post.caption ?? '',
    interestIds: [],
    imported: { key: post.key, takenAt: post.takenAt },
  });
}
