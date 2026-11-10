// POST { url } -> { title, brand, store, image, priceCents, currency }
// Reads a product page so a pasted or shared link fills in the tag form.
// Signed-in users only; public https pages only.
import { isFetchableUrl, parseLinkPreview } from '../_shared/linkpreview.ts';
import { callerId, json } from '../_shared/server.ts';

const TIMEOUT_MS = 8000;
const MAX_BYTES = 3_000_000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!(await callerId(req))) return json(401, { error: 'not_authenticated' });
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!isFetchableUrl(url)) return json(400, { error: 'invalid_url' });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LocaleLinkPreview/1.0)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
      },
    });
    if (!res.ok || !isFetchableUrl(res.url) || !(res.headers.get('content-type') ?? '').includes('html')) {
      return json(422, { error: 'preview_failed' });
    }
    const buf = await res.arrayBuffer();
    const html = new TextDecoder().decode(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf);
    return json(200, parseLinkPreview(html, res.url));
  } catch {
    return json(422, { error: 'preview_failed' });
  } finally {
    clearTimeout(timer);
  }
});
