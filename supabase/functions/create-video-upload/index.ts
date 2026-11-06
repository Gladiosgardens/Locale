// create-video-upload: a one-time Mux upload URL for the signed-in user.
//
// POST {} -> 200 { uploadId, url } | 4xx/5xx { error: "<code>" }
// The phone then PUTs the video file to `url`. At most 20 uploads a day.

import { muxFetch, uploadRequest } from '../_shared/mux.ts';
import { admin, callerId, json, muxCredentials } from '../_shared/server.ts';

const DAILY_LIMIT = 20;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const uid = await callerId(req);
  if (!uid) return json(401, { error: 'not_authenticated' });
  const creds = muxCredentials();
  if (!creds) return json(503, { error: 'video_not_configured' });

  const { data: profile } = await admin.from('profiles').select('onboarded_at').eq('id', uid).maybeSingle();
  if (!profile?.onboarded_at) return json(403, { error: 'not_onboarded' });
  const { data: count, error: countError } = await admin.rpc('video_upload_count_today', { p_profile_id: uid });
  if (countError) return json(500, { error: 'upload_failed' });
  if ((count ?? 0) >= DAILY_LIMIT) return json(429, { error: 'video_rate_limited' });

  try {
    const res = (await muxFetch(creds, '/uploads', { method: 'POST', body: JSON.stringify(uploadRequest(uid)) })) as {
      data?: { id?: string; url?: string };
    };
    const uploadId = res.data?.id;
    const url = res.data?.url;
    if (!uploadId || !url) throw new Error('mux upload response missing id or url');
    const { error } = await admin.from('video_uploads').insert({ upload_id: uploadId, profile_id: uid });
    if (error) throw new Error(`video_uploads insert failed: ${error.message}`);
    return json(200, { uploadId, url });
  } catch (e) {
    console.error('create-video-upload', e);
    return json(502, { error: 'upload_failed' });
  }
});
