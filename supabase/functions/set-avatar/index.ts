// set-avatar: make an uploaded photo the caller's profile photo, or remove it.
//
// POST { path: "<uid>/<uuid>.jpg" } (an upload in post-uploads) -> 200 { avatarPath }
// POST { remove: true } -> 200 { avatarPath: null }
// The photo is re-encoded without metadata (no location) before it's stored.

import { JpegError, sanitizeJpeg } from '../_shared/jpeg.ts';
import { admin, callerId, json } from '../_shared/server.ts';

const MAX_BYTES = 2 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const uid = await callerId(req);
  if (!uid) return json(401, { error: 'not_authenticated' });

  let body: { path?: unknown; remove?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }

  try {
    let newPath: string | null = null;
    if (body.remove !== true) {
      const path = body.path;
      if (typeof path !== 'string' || !new RegExp(`^${uid}/[0-9a-f-]{36}\\.jpg$`).test(path)) {
        return json(400, { error: 'bad_request' });
      }
      const { data: file, error } = await admin.storage.from('post-uploads').download(path);
      if (error || !file) return json(404, { error: 'upload_missing' });
      let clean;
      try {
        clean = sanitizeJpeg(new Uint8Array(await file.arrayBuffer()), MAX_BYTES);
      } catch (e) {
        if (e instanceof JpegError) return json(400, { error: 'invalid_image' });
        throw e;
      }
      newPath = `${uid}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await admin.storage
        .from('avatars')
        .upload(newPath, clean.bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
      if (upErr) throw new Error(`avatar upload failed: ${upErr.message}`);
      await admin.storage.from('post-uploads').remove([path]);
    }

    const { data: oldPath, error: rpcErr } = await admin.rpc('set_avatar_path', { p_profile_id: uid, p_path: newPath });
    if (rpcErr) throw new Error(`set_avatar_path failed: ${rpcErr.message}`);
    if (oldPath) await admin.storage.from('avatars').remove([oldPath as string]);
    return json(200, { avatarPath: newPath });
  } catch (e) {
    console.error('set-avatar', e);
    return json(502, { error: 'avatar_failed' });
  }
});
