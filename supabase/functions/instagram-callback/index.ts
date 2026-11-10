// GET ?code&state: where Instagram sends people after they allow access.
// Exchanges the code for a long-lived token (kept server-side), then returns
// to the app at locale://import-instagram. Deploy with --no-verify-jwt.
// Secrets: INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET.
import { cleanCode } from '../_shared/instagram.ts';
import { admin } from '../_shared/server.ts';

const back = (q: string) => new Response(null, { status: 302, headers: { Location: `locale://import-instagram?${q}` } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return back(url.searchParams.get('error') === 'access_denied' ? 'cancelled=1' : 'error=1');
  const appId = Deno.env.get('INSTAGRAM_APP_ID');
  const secret = Deno.env.get('INSTAGRAM_APP_SECRET');
  if (!appId || !secret) return back('error=1');

  const { data: profileId } = await admin.rpc('take_instagram_state', { p_state: state });
  if (!profileId) return back('error=1');

  try {
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/instagram-callback`;
    const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: appId,
        client_secret: secret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code: cleanCode(code),
      }),
    });
    const shortBody = await shortRes.json();
    const short = (shortBody.data?.[0] ?? shortBody) as { access_token?: string; user_id?: string | number };
    if (!shortRes.ok || !short.access_token) throw new Error(`token ${shortRes.status}`);

    const longRes = await fetch(
      `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: secret,
        access_token: short.access_token,
      })}`,
    );
    const long = (await longRes.json()) as { access_token?: string; expires_in?: number };
    if (!longRes.ok || !long.access_token) throw new Error(`long-lived ${longRes.status}`);

    const meRes = await fetch(`https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(long.access_token)}`);
    const me = (await meRes.json()) as { user_id?: string; username?: string };

    const { error } = await admin.from('instagram_connections').upsert({
      profile_id: profileId,
      ig_user_id: String(me.user_id ?? short.user_id ?? ''),
      username: me.username ?? null,
      access_token: long.access_token,
      expires_at: new Date(Date.now() + (long.expires_in ?? 5_184_000) * 1000).toISOString(),
    });
    if (error) throw error;
    return back('connected=1');
  } catch (e) {
    console.error('instagram-callback', e);
    return back('error=1');
  }
});
