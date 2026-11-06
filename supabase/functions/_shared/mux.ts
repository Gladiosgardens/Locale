// Talking to Mux Video. Pure TypeScript (plus fetch) so Jest can test it.

export const MUX_API = 'https://api.mux.com/video/v1';
export const MAX_VIDEO_SECONDS = 60;
// Phones round lengths; allow a second of slack.
const LENGTH_SLACK = 1;

export type MuxCredentials = { id: string; secret: string };

export function authHeader({ id, secret }: MuxCredentials): string {
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

/** Body for a one-time direct upload. The uploader's id rides along as passthrough. */
export function uploadRequest(uid: string) {
  return {
    cors_origin: '*',
    timeout: 3600,
    new_asset_settings: {
      playback_policy: ['public'],
      video_quality: 'basic',
      max_resolution_tier: '1080p',
      passthrough: uid,
    },
  };
}

export type UploadState = { status: 'waiting' | 'asset_created' | 'failed'; assetId: string | null };

export function parseUpload(json: unknown): UploadState {
  const d = (json as { data?: { status?: string; asset_id?: string } } | null)?.data;
  if (!d) return { status: 'failed', assetId: null };
  if (d.status === 'asset_created' && d.asset_id) return { status: 'asset_created', assetId: d.asset_id };
  if (d.status === 'waiting') return { status: 'waiting', assetId: null };
  return { status: 'failed', assetId: null };
}

export type AssetState =
  | { status: 'processing' }
  | { status: 'failed'; reason: 'errored' | 'not_yours' | 'too_long' | 'no_playback' }
  | { status: 'ready'; playbackId: string; duration: number; width: number; height: number };

type RawAsset = {
  status?: string;
  duration?: number;
  passthrough?: string;
  playback_ids?: { id?: string; policy?: string }[];
  tracks?: { type?: string; max_width?: number; max_height?: number }[];
};

export function parseAsset(json: unknown, uid: string): AssetState {
  const a = (json as { data?: RawAsset } | null)?.data;
  if (!a || a.status === 'errored') return { status: 'failed', reason: 'errored' };
  if (a.passthrough !== uid) return { status: 'failed', reason: 'not_yours' };
  if (a.status !== 'ready') return { status: 'processing' };
  const duration = Number(a.duration ?? 0);
  if (!(duration > 0) || duration > MAX_VIDEO_SECONDS + LENGTH_SLACK) return { status: 'failed', reason: 'too_long' };
  const playbackId = a.playback_ids?.find((p) => p.policy === 'public' && p.id)?.id;
  if (!playbackId) return { status: 'failed', reason: 'no_playback' };
  const track = a.tracks?.find((t) => t.type === 'video');
  return {
    status: 'ready',
    playbackId,
    duration: Math.round(duration * 10) / 10,
    width: Math.round(track?.max_width ?? 1080),
    height: Math.round(track?.max_height ?? 1920),
  };
}

export async function muxFetch(creds: MuxCredentials, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${MUX_API}${path}`, {
    ...init,
    headers: { Authorization: authHeader(creds), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`mux ${init.method ?? 'GET'} ${path} failed: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

/** Where an upload stands, resolving through to the asset once Mux has made one. */
export async function videoState(creds: MuxCredentials, uploadId: string, uid: string): Promise<AssetState & { assetId?: string }> {
  const upload = parseUpload(await muxFetch(creds, `/uploads/${uploadId}`));
  if (upload.status === 'waiting') return { status: 'processing' };
  if (upload.status === 'failed' || !upload.assetId) return { status: 'failed', reason: 'errored' };
  const asset = parseAsset(await muxFetch(creds, `/assets/${upload.assetId}`), uid);
  return { ...asset, assetId: upload.assetId };
}

export const playbackUrl = (playbackId: string) => `https://stream.mux.com/${playbackId}.m3u8`;
export const thumbnailUrl = (playbackId: string, width = 720) =>
  `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${width}&time=1`;
