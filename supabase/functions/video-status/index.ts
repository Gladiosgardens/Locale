// video-status: where the caller's upload stands at Mux.
//
// POST { uploadId } -> 200 { status: "processing" | "ready" | "failed", reason?, duration? }
// The app polls this after uploading and enables Post once it's "ready".

import { videoState } from '../_shared/mux.ts';
import { admin, callerId, json, muxCredentials } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const uid = await callerId(req);
  if (!uid) return json(401, { error: 'not_authenticated' });
  const creds = muxCredentials();
  if (!creds) return json(503, { error: 'video_not_configured' });

  let uploadId: unknown;
  try {
    uploadId = (await req.json()).uploadId;
  } catch {
    return json(400, { error: 'bad_request' });
  }
  if (typeof uploadId !== 'string' || !/^[A-Za-z0-9]{8,80}$/.test(uploadId)) return json(400, { error: 'bad_request' });

  const { data: row } = await admin
    .from('video_uploads')
    .select('upload_id')
    .eq('upload_id', uploadId)
    .eq('profile_id', uid)
    .maybeSingle();
  if (!row) return json(404, { error: 'upload_missing' });

  try {
    const state = await videoState(creds, uploadId, uid);
    if (state.assetId) await admin.from('video_uploads').update({ asset_id: state.assetId }).eq('upload_id', uploadId);
    if (state.status === 'ready') return json(200, { status: 'ready', duration: state.duration });
    if (state.status === 'failed') return json(200, { status: 'failed', reason: state.reason });
    return json(200, { status: 'processing' });
  } catch (e) {
    console.error('video-status', e);
    return json(502, { error: 'status_failed' });
  }
});
