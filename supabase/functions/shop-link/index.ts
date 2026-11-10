// POST { postId, itemId } -> { url }
// Records the tap (start_shop_click) and returns the link to open: the
// network's tracked link carrying our click id, or the plain link when the
// poster used their own affiliate link, tracking is off, or no network is set.
// Secret: AFFILIATE_LINK_TEMPLATE, e.g. https://network/?key=KEY&u={url}&sub={sub}
import { createClient } from 'npm:@supabase/supabase-js@2';
import { wrapLink } from '../_shared/affiliate.ts';
import { json } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'not_authenticated' });
  let body: { postId?: unknown; itemId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  if (typeof body.postId !== 'string' || typeof body.itemId !== 'string') return json(400, { error: 'bad_request' });

  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await asUser.rpc('start_shop_click', { p_post_id: body.postId, p_item_id: body.itemId });
  if (error) {
    const code = /post_not_found|item_not_found/.exec(error.message)?.[0];
    return json(code ? 404 : 500, { error: code ?? 'link_failed' });
  }
  const row = (data as { click_id: string | null; url: string; own_affiliate: boolean }[])[0];
  const template = Deno.env.get('AFFILIATE_LINK_TEMPLATE');
  if (!row.click_id || row.own_affiliate || !template) return json(200, { url: row.url });
  try {
    return json(200, { url: wrapLink(template, row.url, row.click_id) });
  } catch (e) {
    console.error('shop-link template', e);
    return json(200, { url: row.url });
  }
});
