// Shared setup for Edge Functions that act for a signed-in user.
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { MuxCredentials } from './mux.ts';

function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) return JSON.parse(keys).default;
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new Error('No service key available to the function');
}

export const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The caller's user id, or null if the request isn't from a signed-in user. */
export async function callerId(req: Request): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

export function muxCredentials(): MuxCredentials | null {
  const id = Deno.env.get('MUX_TOKEN_ID');
  const secret = Deno.env.get('MUX_TOKEN_SECRET');
  return id && secret ? { id, secret } : null;
}
