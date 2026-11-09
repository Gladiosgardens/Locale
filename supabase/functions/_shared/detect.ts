// Finding items in a photo and where to buy them. Pure TypeScript (plus fetch)
// so Jest can test the parsing.
//
// 1. An Anthropic vision model lists the shoppable items it sees, with a point
//    on each and a short shopping search phrase.
// 2. Google Lens (through SerpApi) looks up each item: the photo plus the
//    phrase, so one photo can yield matches for several items without cropping.

export const MAX_ITEMS = 5;
export const MATCHES_PER_ITEM = 4;

export type DetectedItem = { name: string; category: string; x: number; y: number; query: string };
export type Match = {
  title: string;
  store: string | null;
  url: string;
  host: string;
  priceCents: number | null;
  currency: string | null;
  thumbnail: string | null;
};

export const DETECTION_PROMPT = `List the items in this photo that someone might want to buy: clothing, shoes, bags, jewelry, watches, glasses, furniture, lighting, decor, tableware, gadgets, electronics, sports and outdoor gear, vehicles.
Rules:
- At most ${MAX_ITEMS} items, the most prominent first. Skip anything tiny, blurry or cut off.
- Never describe or identify people, faces, bodies, or anything about who someone is. Describe only the products.
- For each item give: "name" (2-5 words, e.g. "Camel wool coat"), "category" (one word), "x" and "y" (where the item's centre is, as fractions of the image width and height from the top-left, 0 to 1), and "query" (a shopping search phrase with colour, material, style and a visible brand only if you can read it, e.g. "camel double breasted wool coat women").
Report them with the report_items tool. If there is nothing to buy, report an empty list.`;

// Forcing a tool call makes the reply structured JSON, not prose to parse.
export const REPORT_TOOL = {
  name: 'report_items',
  description: 'Report the shoppable items found in the photo.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        maxItems: MAX_ITEMS,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '2-5 words, e.g. "Camel wool coat"' },
            category: { type: 'string', description: 'One word' },
            x: { type: 'number', description: "Centre of the item, fraction of image width from the left (0-1)" },
            y: { type: 'number', description: "Centre of the item, fraction of image height from the top (0-1)" },
            query: { type: 'string', description: 'Shopping search phrase: colour, material, style, readable brand' },
          },
          required: ['name', 'category', 'x', 'y', 'query'],
        },
      },
    },
    required: ['items'],
  },
} as const;

const clamp01 = (n: unknown) => Math.min(Math.max(Number(n), 0.02), 0.98);
const clean = (s: unknown, max: number) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Reads the model's JSON reply (text containing JSON); drops anything malformed. */
export function parseDetection(text: string): DetectedItem[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    return toItems(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return [];
  }
}

/** Reads the report_items tool input (or an equivalent parsed object). */
export function toItems(raw: unknown): DetectedItem[] {
  const items = (raw as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      const o = it as Record<string, unknown>;
      return {
        name: clean(o.name, 80),
        category: clean(o.category, 30).toLowerCase(),
        x: clamp01(o.x),
        y: clamp01(o.y),
        query: clean(o.query, 120),
      };
    })
    .filter((it) => it.name.length >= 2 && it.query.length >= 3 && Number.isFinite(it.x) && Number.isFinite(it.y))
    .slice(0, MAX_ITEMS);
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function priceOf(p: unknown): { cents: number | null; currency: string | null } {
  const o = p as { extracted_value?: number; value?: string; currency?: string } | undefined;
  if (!o) return { cents: null, currency: null };
  const value =
    typeof o.extracted_value === 'number' ? o.extracted_value : Number(String(o.value ?? '').replace(/[^0-9.]/g, ''));
  const symbol = String(o.currency ?? o.value ?? '');
  const currency = /^[A-Z]{3}$/.test(String(o.currency)) ? String(o.currency) : symbol.includes('$') ? 'USD' : symbol.includes('€') ? 'EUR' : symbol.includes('£') ? 'GBP' : null;
  if (!(value > 0) || value > 1_000_000 || !currency) return { cents: null, currency: null };
  return { cents: Math.round(value * 100), currency };
}

/** Pulls buyable matches out of a SerpApi Google Lens response. */
export function parseLensMatches(json: unknown, limit = MATCHES_PER_ITEM): Match[] {
  const j = json as { visual_matches?: unknown[]; products?: unknown[]; exact_matches?: unknown[] } | null;
  const pool = [...(j?.exact_matches ?? []), ...(j?.products ?? []), ...(j?.visual_matches ?? [])];
  const seen = new Set<string>();
  const out: Match[] = [];
  // Prefer results with a price: those are shops, not blogs or image sites.
  const ranked = [...pool].sort((a, b) => Number(!!(b as { price?: unknown }).price) - Number(!!(a as { price?: unknown }).price));
  for (const r of ranked) {
    const o = r as { title?: string; link?: string; source?: string; price?: unknown; thumbnail?: string };
    if (!o.link || !o.title) continue;
    const host = hostOf(o.link);
    if (!host || seen.has(o.link)) continue;
    seen.add(o.link);
    const price = priceOf(o.price);
    out.push({
      title: clean(o.title, 80),
      store: clean(o.source, 60) || null,
      url: o.link,
      host,
      priceCents: price.cents,
      currency: price.currency,
      thumbnail: typeof o.thumbnail === 'string' && /^https:\/\//.test(o.thumbnail) ? o.thumbnail : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export type Detection = { items: DetectedItem[]; note: string };

/** Reads a Messages API response: the tool call if there is one, else any JSON in the text. */
export function readDetectionResponse(body: unknown): Detection {
  const b = body as { stop_reason?: string; content?: { type: string; text?: string; input?: unknown }[] };
  const tool = b.content?.find((c) => c.type === 'tool_use');
  const text = b.content?.find((c) => c.type === 'text')?.text ?? '';
  const items = tool ? toItems(tool.input) : parseDetection(text);
  return { items, note: `stop=${b.stop_reason ?? '?'} tool=${!!tool} text=${clean(text, 200)}` };
}

export async function detectItems(apiKey: string, model: string, jpegBase64: string): Promise<Detection> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      tools: [REPORT_TOOL],
      tool_choice: { type: 'tool', name: 'report_items' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
            { type: 'text', text: DETECTION_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${clean(await res.text(), 300)}`);
  return readDetectionResponse(await res.json());
}

export async function lensMatches(serpApiKey: string, imageUrl: string, query: string | null): Promise<Match[]> {
  const params = new URLSearchParams({ engine: 'google_lens', url: imageUrl, hl: 'en', country: 'us', api_key: serpApiKey });
  if (query) params.set('q', query);
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) throw new Error(`serpapi ${res.status}`);
  return parseLensMatches(await res.json());
}
