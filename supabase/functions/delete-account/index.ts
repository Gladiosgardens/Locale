// POST { confirm: '<your username>' } -> { deleted: true }
// Deletes the caller's account. Removing the auth user cascades through their
// profile to everything they made (posts, comments, messages, follows, saves,
// stories, Instagram connection). Then their files are removed from Storage
// and their videos from Mux. Payout and commission records are kept without
// the link to the person (see 20261111100000_delete_account.sql).
import { authHeader, MUX_API } from '../_shared/mux.ts';
import { admin, callerId, json, muxCredentials } from '../_shared/server.ts';

async function removeFolder(bucket: string, folder: string): Promise<void> {
  const { data } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
  const paths = (data ?? []).map((f) => `${folder}/${f.name}`);
  if (paths.length) await admin.storage.from(bucket).remove(paths);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const uid = await callerId(req);
  if (!uid) return json(401, { error: 'not_authenticated' });
  let body: { confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }

  const { data: profile } = await admin.from('profiles').select('handle').eq('id', uid).maybeSingle();
  const typed = typeof body.confirm === 'string' ? body.confirm.trim().replace(/^@/, '').toLowerCase() : '';
  if (!profile?.handle || typed !== profile.handle) return json(400, { error: 'confirm_mismatch' });

  // Collect the files first: once the account is gone, nothing points to them.
  const { data: files, error: filesErr } = await admin.rpc('account_files', { p_profile_id: uid });
  if (filesErr) {
    if (/payout_in_progress/.test(filesErr.message)) return json(409, { error: 'payout_in_progress' });
    console.error('account_files failed', filesErr.message);
    return json(500, { error: 'delete_failed' });
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    console.error('deleteUser failed', delErr.message);
    return json(500, { error: 'delete_failed' });
  }

  // Best effort from here: the account is already deleted.
  const rows = (files ?? []) as { bucket: string | null; path: string | null; mux_asset_id: string | null }[];
  try {
    const media = rows.filter((r) => r.bucket === 'post-media' && r.path).map((r) => r.path!);
    for (let i = 0; i < media.length; i += 100) await admin.storage.from('post-media').remove(media.slice(i, i + 100));
    await removeFolder('avatars', uid);
    await removeFolder('post-uploads', uid);
  } catch (e) {
    console.error('storage cleanup failed', uid, String(e));
  }
  const creds = muxCredentials();
  if (creds) {
    for (const r of rows) {
      if (!r.mux_asset_id) continue;
      const res = await fetch(`${MUX_API}/assets/${encodeURIComponent(r.mux_asset_id)}`, {
        method: 'DELETE',
        headers: { Authorization: authHeader(creds) },
      }).catch(() => null);
      if (!res || (!res.ok && res.status !== 404)) console.error('mux delete failed', r.mux_asset_id, res?.status);
    }
  }
  return json(200, { deleted: true });
});
