// deliver-notifications: drains the notifications outbox to Expo push.
//
// Invoked by a Database Webhook on notifications INSERT and by a one-minute
// cron (see README). Callers must send the header `x-notify-secret` matching
// the NOTIFY_SECRET function secret; JWT verification is off for this function.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildMessages, chunk, deadTokens, safeEqual, type ExpoMessage, type ExpoTicket, type NotificationRow } from '../_shared/push.ts';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_ROUNDS = 5;

function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) return JSON.parse(keys).default;
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new Error('No service key available to the function');
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function sendChunk(messages: ExpoMessage[]): Promise<ExpoTicket[] | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(EXPO_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
  if (!res.ok) {
    console.error('expo push failed', res.status, await res.text());
    return null;
  }
  const json = await res.json();
  return (json.data ?? []) as ExpoTicket[];
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('NOTIFY_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-notify-secret') ?? '', secret)) {
    return new Response('forbidden', { status: 403 });
  }

  let sent = 0;
  let dropped = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data, error } = await admin.rpc('claim_notifications', { p_limit: 200 });
    if (error) {
      console.error('claim failed', error.message);
      return new Response(JSON.stringify({ error: 'claim_failed' }), { status: 500 });
    }
    const rows = (data ?? []) as NotificationRow[];
    if (!rows.length) break;

    // Rows whose pushes failed to send stay unmarked and are retried after the claim expires.
    const failedIds = new Set<number>();
    const messages = buildMessages(rows);
    const owner = new Map<string, number[]>();
    for (const r of rows) for (const t of r.tokens) owner.set(t, [...(owner.get(t) ?? []), r.id]);

    for (const part of chunk(messages)) {
      const tickets = await sendChunk(part);
      if (!tickets) {
        for (const m of part) for (const id of owner.get(m.to) ?? []) failedIds.add(id);
        continue;
      }
      sent += tickets.filter((t) => t.status === 'ok').length;
      const dead = deadTokens(part, tickets);
      if (dead.length) {
        dropped += dead.length;
        await admin.rpc('drop_push_tokens', { p_tokens: dead });
      }
    }

    const done = rows.map((r) => r.id).filter((id) => !failedIds.has(id));
    if (done.length) await admin.rpc('mark_notifications_sent', { p_ids: done });
    if (rows.length < 200) break;
  }

  return new Response(JSON.stringify({ sent, dropped }), { headers: { 'Content-Type': 'application/json' } });
});
