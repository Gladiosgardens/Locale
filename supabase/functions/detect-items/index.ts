// detect-items: find shoppable items in a photo the caller is about to post.
//
// POST { path: "<uid>/<uuid>.jpg" } (an upload in post-uploads)
//   -> 200 { items: [{ name, category, x, y, query, matches: [...] }] }
// Suggestions only: the poster chooses what becomes a tag. 30 photos a day.

import { detectItems, lensMatches } from '../_shared/detect.ts';
import { admin, callerId, json } from '../_shared/server.ts';

const DAILY_LIMIT = 30;
const SIGNED_SECONDS = 600;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const uid = await callerId(req);
  if (!uid) return json(401, { error: 'not_authenticated' });
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const serpKey = Deno.env.get('SERPAPI_KEY');
  if (!anthropicKey || !serpKey) return json(503, { error: 'detection_not_configured' });

  let path: unknown;
  try {
    path = (await req.json()).path;
  } catch {
    return json(400, { error: 'bad_request' });
  }
  if (typeof path !== 'string' || !new RegExp(`^${uid}/[0-9a-f-]{36}\\.jpg$`).test(path)) {
    return json(400, { error: 'bad_request' });
  }

  const { data: allowed, error: limitError } = await admin.rpc('use_detection', {
    p_profile_id: uid,
    p_kind: 'detect',
    p_daily_limit: DAILY_LIMIT,
  });
  if (limitError) return json(500, { error: 'detection_failed' });
  if (!allowed) return json(429, { error: 'detection_rate_limited' });

  try {
    const { data: file, error } = await admin.storage.from('post-uploads').download(path);
    if (error || !file) return json(404, { error: 'upload_missing' });
    const items = await detectItems(
      anthropicKey,
      Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-5-5',
      toBase64(new Uint8Array(await file.arrayBuffer())),
    );
    if (!items.length) return json(200, { items: [] });

    const { data: signed } = await admin.storage.from('post-uploads').createSignedUrl(path, SIGNED_SECONDS);
    if (!signed?.signedUrl) return json(200, { items: items.map((it) => ({ ...it, matches: [] })) });
    // Look items up in parallel; one failed lookup just leaves that item without matches.
    const results = await Promise.all(
      items.map(async (it) => ({ ...it, matches: await lensMatches(serpKey, signed.signedUrl, it.query).catch(() => []) })),
    );
    return json(200, { items: results });
  } catch (e) {
    console.error('detect-items', e);
    return json(502, { error: 'detection_failed' });
  }
});
