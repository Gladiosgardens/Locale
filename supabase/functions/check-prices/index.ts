// POST (daily, from cron): reads saved items' product pages and records their
// price and stock; record_price notifies savers about drops and restocks.
// Header x-prices-secret must match PRICES_SECRET. Deploy with --no-verify-jwt.
import { extractOffer } from '../_shared/prices.ts';
import { safeEqual } from '../_shared/push.ts';
import { admin, json } from '../_shared/server.ts';

const BATCH = 100;
const PARALLEL = 5;
const TIMEOUT_MS = 8000;
const MAX_BYTES = 3_000_000;

async function readPage(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LocalePriceCheck/1.0)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
      },
    });
    if (!res.ok || !res.url.startsWith('https://')) return null;
    if (!(res.headers.get('content-type') ?? '').includes('html')) return null;
    const buf = await res.arrayBuffer();
    return new TextDecoder().decode(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PRICES_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-prices-secret') ?? '', secret)) return json(403, { error: 'forbidden' });
  const { data, error } = await admin.rpc('items_to_check', { p_limit: BATCH });
  if (error) return json(500, { error: error.message });
  const items = (data ?? []) as { item_id: string; url: string }[];

  const result = { checked: 0, drops: 0, restocks: 0, failed: 0 };
  for (let i = 0; i < items.length; i += PARALLEL) {
    await Promise.all(
      items.slice(i, i + PARALLEL).map(async (it) => {
        const html = await readPage(it.url);
        const offer = html ? extractOffer(html) : null;
        if (!offer) {
          await admin.rpc('record_price_failure', { p_item_id: it.item_id });
          result.failed += 1;
          return;
        }
        const { data: change } = await admin.rpc('record_price', {
          p_item_id: it.item_id,
          p_price_cents: offer.priceCents,
          p_currency: offer.currency,
          p_in_stock: offer.inStock,
        });
        result.checked += 1;
        if (change === 'drop') result.drops += 1;
        if (change === 'restock') result.restocks += 1;
      }),
    );
  }
  return json(200, result);
});
