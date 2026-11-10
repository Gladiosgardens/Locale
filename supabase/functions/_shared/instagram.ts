// Instagram API with Instagram Login: URLs and response parsing (plain TS for Jest).

export const IG_SCOPE = 'instagram_business_basic';

export function authorizeUrl(appId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: 'code', scope: IG_SCOPE, state });
  return `https://www.instagram.com/oauth/authorize?${q.toString()}`;
}

/** Instagram appends "#_" to the code; it isn't part of it. */
export const cleanCode = (code: string) => code.replace(/#_$/, '');

export const MEDIA_FIELDS = 'id,caption,media_type,media_url,thumbnail_url,timestamp,children{id,media_type,media_url}';

export type IgPost = {
  id: string;
  caption: string | null;
  takenAt: string;
  /** The photos to import, in order (videos inside carousels are skipped). */
  images: string[];
  thumbnail: string;
};

type RawMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp?: string;
  children?: { data?: { id: string; media_type?: string; media_url?: string }[] };
};

/** Photos and carousels with at least one photo; reels and videos aren't imported. */
export function toIgPost(m: RawMedia): IgPost | null {
  const images =
    m.media_type === 'CAROUSEL_ALBUM'
      ? (m.children?.data ?? []).filter((c) => c.media_type === 'IMAGE' && c.media_url).map((c) => c.media_url!)
      : m.media_type === 'IMAGE' && m.media_url
        ? [m.media_url]
        : [];
  if (!images.length || !m.timestamp) return null;
  return {
    id: m.id,
    caption: m.caption ? m.caption.slice(0, 2200) : null,
    takenAt: new Date(m.timestamp).toISOString(),
    images: images.slice(0, 10),
    thumbnail: images[0],
  };
}

export function parseMediaPage(body: { data?: RawMedia[]; paging?: { cursors?: { after?: string }; next?: string } }): {
  posts: IgPost[];
  after: string | null;
} {
  return {
    posts: (body.data ?? []).map(toIgPost).filter((p): p is IgPost => !!p),
    after: body.paging?.next ? (body.paging.cursors?.after ?? null) : null,
  };
}
