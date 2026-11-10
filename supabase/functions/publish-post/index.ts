// publish-post: turns the caller's held uploads into a published post.
//
// POST { uploads: ["<uid>/<uuid>.jpg", ...] | video: { uploadId }, caption?: string,
//        interestIds?: number[], tags?: [{ media, x, y, item: {...} }], searchable?: boolean,
//        groupId?: string, shopping?: boolean, story?: boolean, asking?: boolean }
//   -> 200 { id } | 4xx/5xx { error: "<code>" }
//
// Steps: verify the caller, re-sanitise every image (strip EXIF/GPS/XMP/IPTC,
// drop appended data), copy to the private post-media bucket under the new
// post id, create the post rows in one transaction, delete the originals.
// For a video: check with Mux that it belongs to the caller, is ready and is at
// most 60 seconds, then attach it.
// A story (story: true) is one photo or video with an optional short caption
// and item tags; it expires after 24 hours.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { JpegError, sanitizeJpeg } from '../_shared/jpeg.ts';
import { videoState } from '../_shared/mux.ts';
import { muxCredentials } from '../_shared/server.ts';

const MAX_IMAGES = 10;
const MAX_CAPTION = 2200;
const MAX_STORY_CAPTION = 200;
const MAX_DIMENSION = 8192;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TAGS = 20;

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
  too_many_tags: 400,
  invalid_tag: 400,
  invalid_url: 400,
  shortened_url: 400,
  not_a_member: 403,
  invalid_video: 400,
  story_rate_limited: 429,
  invalid_caption: 400,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Body = {
  uploads?: unknown;
  video?: unknown;
  shopping?: unknown;
  caption?: unknown;
  interestIds?: unknown;
  tags?: unknown;
  searchable?: unknown;
  groupId?: unknown;
  story?: unknown;
  asking?: unknown;
};

function parseBody(body: Body, uid: string) {
  const video = body.video as { uploadId?: unknown } | undefined;
  const videoUploadId = video ? video.uploadId : null;
  if (videoUploadId !== null && (typeof videoUploadId !== 'string' || !/^[A-Za-z0-9]{8,80}$/.test(videoUploadId))) {
    throw new PublishError(400, 'invalid_video');
  }
  const story = body.story === true;
  const uploads = Array.isArray(body.uploads) ? body.uploads : [];
  if (story && uploads.length > 1) throw new PublishError(400, 'media_count');
  if (videoUploadId ? uploads.length !== 0 : uploads.length < 1 || uploads.length > MAX_IMAGES) {
    throw new PublishError(400, 'media_count');
  }
  const pathPattern = new RegExp(`^${uid}/[0-9a-f-]{36}\\.jpg$`);
  if (!uploads.every((p) => typeof p === 'string' && pathPattern.test(p)) || new Set(uploads).size !== uploads.length) {
    throw new PublishError(400, 'bad_upload_path');
  }

  const caption = body.caption ?? null;
  if (caption !== null && (typeof caption !== 'string' || caption.length > (story ? MAX_STORY_CAPTION : MAX_CAPTION))) {
    throw new PublishError(400, 'bad_caption');
  }

  const interestIds = body.interestIds ?? [];
  if (!Array.isArray(interestIds) || !interestIds.every((n) => Number.isInteger(n) && n > 0 && n < 32768)) {
    throw new PublishError(400, 'unknown_interest');
  }

  // Tag contents are validated by create_post_record; only the shape is checked here.
  const tags = body.tags ?? [];
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every((t) => t && typeof t === 'object')) {
    throw new PublishError(400, 'invalid_tag');
  }

  const searchable = body.searchable ?? true;
  if (typeof searchable !== 'boolean') throw new PublishError(400, 'bad_request');

  const groupId = body.groupId ?? null;
  if (groupId !== null && (typeof groupId !== 'string' || !/^[0-9a-f-]{36}$/.test(groupId))) {
    throw new PublishError(400, 'bad_request');
  }

  if (story && groupId !== null) throw new PublishError(400, 'bad_request');

  return {
    story,
    asking: body.asking === true,
    shopping: body.shopping !== false,
    videoUploadId: videoUploadId as string | null,
    uploads: uploads as string[],
    caption: caption as string | null,
    interestIds: interestIds as number[],
    tags,
    searchable,
    groupId: groupId as string | null,
  };
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
    const media: Record<string, unknown>[] = [];

    if (input.videoUploadId) {
      const creds = muxCredentials();
      if (!creds) throw new PublishError(503, 'video_not_configured');
      const state = await videoState(creds, input.videoUploadId, uid);
      if (state.status === 'processing') throw new PublishError(409, 'video_processing');
      if (state.status === 'failed') {
        throw new PublishError(400, state.reason === 'too_long' ? 'video_too_long' : 'invalid_video');
      }
      // Record the asset so create_post_record can check this caller owns it.
      await admin
        .from('video_uploads')
        .update({ asset_id: state.assetId })
        .eq('upload_id', input.videoUploadId)
        .eq('profile_id', uid);
      media.push({
        kind: 'video',
        asset_id: state.assetId,
        playback_id: state.playbackId,
        duration: state.duration,
        width: state.width,
        height: state.height,
      });
    }

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

    // With shopping off, nothing is tagged.
    const tags = input.shopping ? input.tags : [];
    const { error: rpcError } = input.story
      ? await admin.rpc('create_story_record', {
          p_post_id: postId,
          p_author_id: uid,
          p_caption: input.caption,
          p_media: media,
          p_tags: tags,
        })
      : await admin.rpc('create_post_record', {
          p_post_id: postId,
          p_author_id: uid,
          p_caption: input.caption,
          p_interest_ids: input.interestIds,
          p_media: media,
          p_tags: tags,
          p_searchable: input.searchable,
          p_group_id: input.groupId,
        });
    if (rpcError) {
      const status = RPC_ERRORS[rpcError.message];
      if (status) throw new PublishError(status, rpcError.message);
      throw new Error(`create_post_record failed: ${rpcError.message}`);
    }

    if (!input.shopping) {
      await admin.from('posts').update({ shopping_enabled: false }).eq('id', postId);
    } else if (input.asking && !input.story && !input.groupId) {
      // "Where's this from?": others can suggest answers.
      await admin.from('posts').update({ asking: true }).eq('id', postId);
    }
    return json(200, { id: postId });
  } catch (e) {
    if (written.length) await admin.storage.from('post-media').remove(written);
    if (e instanceof PublishError) return json(e.status, { error: e.code });
    console.error('publish-post', e);
    return json(500, { error: 'publish_failed' });
  } finally {
    // Originals are never needed again; the app re-uploads on retry.
    if (input.uploads.length) await admin.storage.from('post-uploads').remove(input.uploads);
  }
});
