// POST { action: 'start' } -> { url }              Instagram's sign-in page
// POST { action: 'media', after? } -> { posts, after }   recent photos and carousels
// POST { action: 'import', ids: string[] } -> { imported, skipped }   up to 10 at a time
// Imported photos are cleaned (sanitizeJpeg) and published as ordinary posts
// with their Instagram date; each Instagram post is imported once.
// Secrets: INSTAGRAM_APP_ID (and INSTAGRAM_APP_SECRET for the callback).
import { authorizeUrl, MEDIA_FIELDS, parseMediaPage, toIgPost } from '../_shared/instagram.ts';
import { JpegError, sanitizeJpeg } from '../_shared/jpeg.ts';
import { admin, callerId, json } from '../_shared/server.ts';

const MAX_IMPORT = 10;
const MAX_BYTES = 10 * 1024 * 1024;

function randomState(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function token(uid: string): Promise<string | null> {
  const { data } = await admin
    .from('instagram_connections')
    .select('access_token, expires_at')
    .eq('profile_id', uid)
    .maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  // Keep the 60-day token alive while it's in use (allowed once it's a day old).
  if (new Date(data.expires_at).getTime() - Date.now() < 50 * 86_400_000) {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(data.access_token)}`);
    const body = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (r.ok && body.access_token) {
      await admin
        .from('instagram_connections')
        .update({ access_token: body.access_token, expires_at: new Date(Date.now() + (body.expires_in ?? 5_184_000) * 1000).toISOString() })
        .eq('profile_id', uid);
      return body.access_token;
    }
  }
  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const uid = await callerId(req);
  if (!uid) return json(401, { error: 'not_authenticated' });
  const appId = Deno.env.get('INSTAGRAM_APP_ID');
  if (!appId) return json(503, { error: 'instagram_not_configured' });
  let body: { action?: unknown; after?: unknown; ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }

  if (body.action === 'start') {
    const state = randomState();
    const { error } = await admin.from('instagram_oauth_states').insert({ state, profile_id: uid });
    if (error) return json(500, { error: 'instagram_failed' });
    return json(200, { url: authorizeUrl(appId, `${Deno.env.get('SUPABASE_URL')}/functions/v1/instagram-callback`, state) });
  }

  const access = await token(uid);
  if (!access) return json(409, { error: 'instagram_not_connected' });

  if (body.action === 'media') {
    const q = new URLSearchParams({ fields: MEDIA_FIELDS, limit: '24', access_token: access });
    if (typeof body.after === 'string' && body.after) q.set('after', body.after);
    const res = await fetch(`https://graph.instagram.com/me/media?${q}`);
    if (!res.ok) {
      console.error('instagram media', res.status, await res.text());
      return json(502, { error: 'instagram_failed' });
    }
    const page = parseMediaPage(await res.json());
    const { data: done } = await admin
      .from('instagram_imports')
      .select('ig_media_id')
      .eq('profile_id', uid)
      .in('ig_media_id', page.posts.map((p) => p.id));
    const imported = new Set((done ?? []).map((d: { ig_media_id: string }) => d.ig_media_id));
    return json(200, { posts: page.posts.map((p) => ({ ...p, imported: imported.has(p.id) })), after: page.after });
  }

  if (body.action === 'import') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && /^\d+$/.test(x)) : [];
    if (!ids.length || ids.length > MAX_IMPORT) return json(400, { error: 'bad_request' });
    const imported: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const { data: already } = await admin
        .from('instagram_imports')
        .select('ig_media_id')
        .eq('profile_id', uid)
        .eq('ig_media_id', id)
        .maybeSingle();
      if (already) {
        skipped.push({ id, reason: 'already_imported' });
        continue;
      }
      const res = await fetch(`https://graph.instagram.com/${id}?fields=${encodeURIComponent(MEDIA_FIELDS)}&access_token=${encodeURIComponent(access)}`);
      const post = res.ok ? toIgPost(await res.json()) : null;
      if (!post) {
        skipped.push({ id, reason: 'not_a_photo' });
        continue;
      }
      const postId = crypto.randomUUID();
      const written: string[] = [];
      try {
        const media: { path: string; width: number; height: number }[] = [];
        for (const [i, src] of post.images.entries()) {
          const img = await fetch(src);
          if (!img.ok) continue;
          let clean;
          try {
            clean = sanitizeJpeg(new Uint8Array(await img.arrayBuffer()), MAX_BYTES);
          } catch (e) {
            if (e instanceof JpegError) continue; // not a JPEG: skip that photo
            throw e;
          }
          const path = `${postId}/${i}.jpg`;
          const { error: upErr } = await admin.storage.from('post-media').upload(path, clean.bytes, { contentType: 'image/jpeg' });
          if (upErr) throw upErr;
          written.push(path);
          media.push({ path, width: clean.width, height: clean.height });
        }
        if (!media.length) {
          skipped.push({ id, reason: 'not_a_photo' });
          continue;
        }
        const { error: rpcErr } = await admin.rpc('create_post_record', {
          p_post_id: postId,
          p_author_id: uid,
          p_caption: post.caption,
          p_interest_ids: [],
          p_media: media,
          p_tags: [],
          p_searchable: true,
          p_group_id: null,
        });
        if (rpcErr) throw new Error(rpcErr.message);
        await admin.rpc('set_imported_post_date', { p_post_id: postId, p_profile_id: uid, p_at: post.takenAt });
        await admin.from('instagram_imports').insert({ profile_id: uid, ig_media_id: id, post_id: postId });
        imported.push(id);
      } catch (e) {
        if (written.length) await admin.storage.from('post-media').remove(written);
        const msg = e instanceof Error ? e.message : String(e);
        skipped.push({ id, reason: /rate_limited/.test(msg) ? 'rate_limited' : 'failed' });
        console.error('instagram import', id, e);
        if (/rate_limited/.test(msg)) break; // the daily post limit: stop here
      }
    }
    return json(200, { imported, skipped });
  }

  return json(400, { error: 'bad_request' });
});
