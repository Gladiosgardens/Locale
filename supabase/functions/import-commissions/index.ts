// POST { network: "sovrn", rows: [{ external_id, sub_id, commission, sale,
//        currency, status, occurred_at }] } -> counts
// Records sales reported by an affiliate network (from its export or API).
// Re-sending the same rows is safe: each (network, external_id) is upserted.
// Header x-import-secret must match the IMPORT_SECRET function secret.
// Deploy with --no-verify-jwt.
import { parseImportRow, type ImportRow } from '../_shared/affiliate.ts';
import { safeEqual } from '../_shared/push.ts';
import { admin, json } from '../_shared/server.ts';

const MAX_ROWS = 1000;

Deno.serve(async (req) => {
  const secret = Deno.env.get('IMPORT_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-import-secret') ?? '', secret)) return json(403, { error: 'forbidden' });
  let body: { network?: unknown; rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const network = typeof body.network === 'string' ? body.network.trim().toLowerCase() : '';
  if (!/^[a-z0-9_-]{2,30}$/.test(network) || !Array.isArray(body.rows) || body.rows.length > MAX_ROWS) {
    return json(400, { error: 'bad_request' });
  }

  const counts = { credited: 0, locale: 0, unchanged: 0 };
  const skipped: string[] = [];
  for (const raw of body.rows as ImportRow[]) {
    const r = parseImportRow(raw);
    if ('error' in r) {
      skipped.push(r.error);
      continue;
    }
    const { data, error } = await admin.rpc('import_commission', {
      p_network: network,
      p_external_id: r.externalId,
      p_sub_id: r.subId,
      p_commission_cents: r.commissionCents,
      p_sale_cents: r.saleCents,
      p_currency: r.currency,
      p_status: r.status,
      p_occurred_at: r.occurredAt,
    });
    if (error) skipped.push(`${r.externalId}: ${error.message}`);
    else counts[data as keyof typeof counts] += 1;
  }
  return json(200, { ...counts, skipped });
});
