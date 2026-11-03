// Client-side mirror of public.item_url_host() so people get instant feedback.
// The server re-validates and derives the host itself.

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly',
  'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 't.ly', 'lnkd.in', 'trib.al', 's.id',
  'v.gd', 'bl.ink', 'short.io', 'amzn.to', 'a.co',
]);
const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export type LinkCheck = { ok: true; host: string } | { ok: false; error: 'invalid_url' | 'shortened_url' };

export function checkItemLink(raw: string): LinkCheck {
  const url = raw.trim();
  if (url.length > 2000 || /\s/.test(url)) return { ok: false, error: 'invalid_url' };
  const match = /^https:\/\/([^/?#]*)/i.exec(url);
  if (!match || !/^https:\/\//.test(url)) return { ok: false, error: 'invalid_url' };
  const authority = match[1];
  if (!authority || authority.includes('@')) return { ok: false, error: 'invalid_url' };
  const host = authority.toLowerCase().replace(/:[0-9]{1,5}$/, '').replace(/\.$/, '');
  if (!HOST.test(host)) return { ok: false, error: 'invalid_url' };
  if (SHORTENERS.has(host)) return { ok: false, error: 'shortened_url' };
  return { ok: true, host };
}

// "24.99", "$1,299", "15" -> cents; null for blank; NaN for junk.
export function parsePriceCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}

export function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
