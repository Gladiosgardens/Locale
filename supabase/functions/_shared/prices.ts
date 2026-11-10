// Reads a product page's current price and stock from the structured data most
// stores publish (schema.org Product/Offer in JSON-LD), falling back to the
// Open Graph / product meta tags. Plain TypeScript so Jest can test it.

export type Offer = { priceCents: number; currency: string; inStock: boolean | null };

function cents(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) : null;
}

function stock(v: unknown): boolean | null {
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase();
  if (/(instock|limitedavailability|onlineonly|preorder|presale)/.test(s)) return true;
  if (/(outofstock|soldout|discontinued|backorder)/.test(s)) return false;
  return null;
}

function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
  } else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    yield o;
    if (o['@graph']) yield* walk(o['@graph']);
  }
}

const isType = (o: Record<string, unknown>, t: string) =>
  ([] as unknown[]).concat(o['@type'] ?? []).some((x) => typeof x === 'string' && x.toLowerCase() === t);

function fromOffer(o: Record<string, unknown>): Offer | null {
  const spec = (o.priceSpecification ?? null) as Record<string, unknown> | null;
  const price = cents(o.price ?? o.lowPrice ?? spec?.price);
  const currency = String(o.priceCurrency ?? spec?.priceCurrency ?? '').toUpperCase();
  if (price == null || !/^[A-Z]{3}$/.test(currency)) return null;
  return { priceCents: price, currency, inStock: stock(o.availability) };
}

function fromJsonLd(html: string): Offer | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const o of walk(data)) {
      if (!isType(o, 'product') && !isType(o, 'productgroup')) continue;
      for (const offer of walk(o.offers ?? [])) {
        const found = fromOffer(offer);
        if (found) return found;
      }
    }
  }
  return null;
}

function meta(html: string, names: string[]): string | null {
  for (const name of names) {
    const esc = name.replace(/[:.]/g, '\\$&');
    const a = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${esc}["'][^>]*content=["']([^"']+)["']`, 'i').exec(html);
    const b = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${esc}["']`, 'i').exec(html);
    const v = a?.[1] ?? b?.[1];
    if (v) return v;
  }
  return null;
}

function fromMeta(html: string): Offer | null {
  const price = cents(meta(html, ['product:price:amount', 'og:price:amount', 'price']));
  const currency = (meta(html, ['product:price:currency', 'og:price:currency', 'priceCurrency']) ?? '').toUpperCase();
  if (price == null || !/^[A-Z]{3}$/.test(currency)) return null;
  return { priceCents: price, currency, inStock: stock(meta(html, ['product:availability', 'og:availability', 'availability'])) };
}

export function extractOffer(html: string): Offer | null {
  return fromJsonLd(html) ?? fromMeta(html);
}
