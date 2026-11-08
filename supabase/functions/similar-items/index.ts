// similar-items: products similar to an item on a post, for viewers.
//
// POST { itemId, postId } -> 200 { matches: [...] }
// Only for posts the caller can see whose author shows shopping. Results are
// kept for a week; new lookups are limited to 40 a day per person.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { lensMatches } from '../_shared/detect.ts';
import { admin, callerId, json } from '../_shared/server.ts';

const DAILY_LIMIT = 40;
const CACHE_DAYS = 7;
const UUID = /^[0-9a-f-]{36}$/;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const uid = await callerId(req);
  if (!uid) return json(401, { error: 'not_authenticated' });
  const serpKey = Deno.env.get('SERPAPI_KEY');
  if (!serpKey) return json(503, { error: 'detection_not_configured' });

  let body: { itemId?: unknown; postId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const { itemId, postId } = body;
  if (typeof itemId !== 'string' || typeof postId !== 'string' || !UUID.test(itemId) || !UUID.test(postId)) {
    return json(400, { error: 'bad_request' });
  }

  // Visibility is checked as the caller, with their own token.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
    auth: { persistSession: false },
  });
  const { data: source } = await asUser.rpc('similar_item_source', { p_item_id: itemId, p_post_id: postId });
  const row = (source as { storage_path: string; title: string }[] | null)?.[0];
  if (!row) return json(404, { error: 'item_not_found' });

  const { data: cached } = await admin.from('item_suggestions').select('results, created_at').eq('item_id', itemId).maybeSingle();
  if (cached && Date.now() - new Date(cached.created_at).getTime() < CACHE_DAYS * 86_400_000) {
    return json(200, { matches: cached.results });
  }

  const { data: allowed } = await admin.rpc('use_detection', { p_profile_id: uid, p_kind: 'similar', p_daily_limit: DAILY_LIMIT });
  if (!allowed) return json(429, { error: 'detection_rate_limited' });

  try {
    const { data: signed } = await admin.storage.from('post-media').createSignedUrl(row.storage_path, 600);
    if (!signed?.signedUrl) return json(404, { error: 'item_not_found' });
    const matches = await lensMatches(serpKey, signed.signedUrl, row.title);
    await admin.from('item_suggestions').upsert({ item_id: itemId, results: matches, created_at: new Date().toISOString() });
    return json(200, { matches });
  } catch (e) {
    console.error('similar-items', e);
    return json(502, { error: 'detection_failed' });
  }
});
