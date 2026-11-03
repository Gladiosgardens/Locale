// publish-post: turns the caller's held uploads into a published post.
//
// POST { uploads: ["<uid>/<uuid>.jpg", ...], caption?: string, interestIds?: number[] }
//   -> 200 { id } | 4xx/5xx { error: "<code>" }
//
// Steps: verify the caller, re-sanitise every image (strip EXIF/GPS/XMP/IPTC,
// drop appended data), copy to the private post-media bucket under the new
// post id, create the post rows in one transaction, delete the originals.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { JpegError, sanitizeJpeg } from '../_shared/jpeg.ts';

const MAX_IMAGES = 10;
const MAX_CAPTION = 2200;
const MAX_DIMENSION = 8192;
const MAX_BYTES = 10 * 1024 * 1024;

function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) return JSON.parse(keys).default;
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new Error('No service key available to the function');
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

class PublishError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

// Errors raised by create_post_record that the app knows how to explain.
const RPC_ERRORS: Record<string, number> = {
  not_onboarded: 403,
  post_rate_limited: 429,
  media_count: 400,
  too_many_interests: 400,
  unknown_interest: 400,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Body = { uploads?: unknown; caption?: unknown; interestIds?: unknown };

function parseBody(body: Body, uid: string) {
  const uploads = Array.isArray(body.uploads) ? body.uploads : [];
  if (uploads.length < 1 || uploads.length > MAX_IMAGES) throw new PublishError(400, 'media_count');
  const pathPattern = new RegExp(`^${uid}/[0-9a-f-]{36}\\.jpg$`);
  if (!uploads.every((p) => typeof p === 'string' && pathPattern.test(p)) || new Set(uploads).size !== uploads.length) {
    throw new PublishError(400, 'bad_upload_path');
  }

  const caption = body.caption ?? null;
  if (caption !== null && (typeof caption !== 'string' || caption.length > MAX_CAPTION)) {
    throw new PublishError(400, 'bad_caption');
  }

  const interestIds = body.interestIds ?? [];
  if (!Array.isArray(interestIds) || !interestIds.every((n) => Number.isInteger(n) && n > 0 && n < 32768)) {
    throw new PublishError(400, 'unknown_interest');
  }

  return { uploads: uploads as string[], caption: caption as string | null, interestIds: interestIds as number[] };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'not_authenticated' });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json(401, { error: 'not_authenticated' });
  const uid = auth.user.id;

  let input: ReturnType<typeof parseBody>;
  try {
    input = parseBody(await req.json(), uid);
  } catch (e) {
    return json(400, { error: e instanceof PublishError ? e.code : 'bad_request' });
  }

  const postId = crypto.randomUUID();
  const written: string[] = [];

  try {
    const media: { path: string; width: number; height: number }[] = [];

    for (const [i, source] of input.uploads.entries()) {
      const { data: file, error } = await admin.storage.from('post-uploads').download(source);
      if (error || !file) throw new PublishError(400, 'upload_missing');

      let clean;
      try {
        clean = sanitizeJpeg(new Uint8Array(await file.arrayBuffer()), MAX_BYTES);
      } catch (e) {
        if (e instanceof JpegError) throw new PublishError(400, 'invalid_image');
        throw e;
      }
      if (clean.width > MAX_DIMENSION || clean.height > MAX_DIMENSION) {
        throw new PublishError(400, 'invalid_image');
      }

      const dest = `${postId}/${i}.jpg`;
      const { error: uploadError } = await admin.storage
        .from('post-media')
        .upload(dest, clean.bytes, { contentType: 'image/jpeg', upsert: false });
      if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);
      written.push(dest);
      media.push({ path: dest, width: clean.width, height: clean.height });
    }

    const { error: rpcError } = await admin.rpc('create_post_record', {
      p_post_id: postId,
      p_author_id: uid,
      p_caption: input.caption,
      p_interest_ids: input.interestIds,
      p_media: media,
    });
    if (rpcError) {
      const status = RPC_ERRORS[rpcError.message];
      if (status) throw new PublishError(status, rpcError.message);
      throw new Error(`create_post_record failed: ${rpcError.message}`);
    }

    return json(200, { id: postId });
  } catch (e) {
    if (written.length) await admin.storage.from('post-media').remove(written);
    if (e instanceof PublishError) return json(e.status, { error: e.code });
    console.error('publish-post', e);
    return json(500, { error: 'publish_failed' });
  } finally {
    // Originals are never needed again; the app re-uploads on retry.
    await admin.storage.from('post-uploads').remove(input.uploads);
  }
});
