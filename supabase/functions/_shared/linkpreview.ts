// What a product link points to: name, brand, store, price and image, read
// from the page's schema.org Product data and Open Graph tags. Plain TS (Jest).
import { extractOffer } from './prices.ts';

export type LinkPreview = {
  title: string | null;
  brand: string | null;
  store: string | null;
  image: string | null;
  priceCents: number | null;
  currency: string | null;
};

/** Only public https pages on a real host name (no IPs, localhost or internal names). */
export function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host === 'localhost') return false;
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  return true;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

function meta(html: string, name: string): string | null {
  const esc = name.replace(/[:.]/g, '\\$&');
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${esc}["']`, 'i').exec(html);
  const v = a?.[1] ?? b?.[1];
  return v ? decode(v) : null;
}

function product(html: string): Record<string, unknown> | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const stack: unknown[] = [JSON.parse(m[1].trim())];
      while (stack.length) {
        const n = stack.pop();
        if (Array.isArray(n)) stack.push(...n);
        else if (n && typeof n === 'object') {
          const o = n as Record<string, unknown>;
          const t = ([] as unknown[]).concat(o['@type'] ?? []).map((x) => String(x).toLowerCase());
          if (t.includes('product')) return o;
          if (o['@graph']) stack.push(o['@graph']);
        }
      }
    } catch {
      // ignore broken JSON-LD blocks
    }
  }
  return null;
}

const text = (v: unknown): string | null => {
  if (typeof v === 'string') return decode(v) || null;
  if (v && typeof v === 'object' && 'name' in v) return text((v as { name: unknown }).name);
  if (Array.isArray(v)) return text(v[0]);
  return null;
};

const clipTo = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function parseLinkPreview(html: string, pageUrl: string): LinkPreview {
  const p = product(html);
  const offer = extractOffer(html);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  let image = text(p?.image) ?? meta(html, 'og:image');
  if (image) {
    try {
      image = new URL(image, pageUrl).toString();
      if (!image.startsWith('https://')) image = null;
    } catch {
      image = null;
    }
  }
  return {
    title: clipTo(text(p?.name) ?? meta(html, 'og:title') ?? (titleTag ? decode(titleTag) : null), 80),
    brand: clipTo(text(p?.brand), 60),
    store: clipTo(meta(html, 'og:site_name'), 60),
    image,
    priceCents: offer?.priceCents ?? null,
    currency: offer?.currency ?? null,
  };
}
