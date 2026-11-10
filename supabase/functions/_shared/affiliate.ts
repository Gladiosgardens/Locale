// Affiliate links and commission imports. Plain TypeScript (no Deno APIs) so
// Jest can test it.

/**
 * Turns a shop link into the network's tracked link. The template comes from
 * the network's docs, e.g. "https://network.example/?key=KEY&u={url}&sub={sub}":
 * {url} is replaced by the encoded destination and {sub} by our click id.
 */
export function wrapLink(template: string, url: string, subId: string): string {
  if (!template.startsWith('https://') || !template.includes('{url}')) {
    throw new Error('AFFILIATE_LINK_TEMPLATE must be an https URL containing {url}');
  }
  return template.replaceAll('{url}', encodeURIComponent(url)).replaceAll('{sub}', encodeURIComponent(subId));
}

export type CommissionStatus = 'pending' | 'locked' | 'reversed';

// Networks name the same states differently.
const STATUS: Record<string, CommissionStatus> = {
  pending: 'pending',
  open: 'pending',
  new: 'pending',
  unconfirmed: 'pending',
  extended: 'pending',
  locked: 'locked',
  approved: 'locked',
  confirmed: 'locked',
  payable: 'locked',
  paid: 'locked',
  closed: 'locked',
  final: 'locked',
  reversed: 'reversed',
  declined: 'reversed',
  rejected: 'reversed',
  cancelled: 'reversed',
  canceled: 'reversed',
  void: 'reversed',
  voided: 'reversed',
  returned: 'reversed',
  refunded: 'reversed',
};

export function normalizeStatus(raw: unknown): CommissionStatus | null {
  return typeof raw === 'string' ? (STATUS[raw.trim().toLowerCase()] ?? null) : null;
}

/** "12.34", "$12.34", "1,234.50" or 12.34 -> cents. Null if not a non-negative amount. */
export function toCents(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

export type ImportRow = {
  external_id: unknown;
  sub_id?: unknown;
  commission: unknown;
  sale?: unknown;
  currency?: unknown;
  status: unknown;
  occurred_at: unknown;
};

export type CommissionRecord = {
  externalId: string;
  subId: string | null;
  commissionCents: number;
  saleCents: number | null;
  currency: string;
  status: CommissionStatus;
  occurredAt: string;
};

export function parseImportRow(row: ImportRow): CommissionRecord | { error: string } {
  const externalId = typeof row.external_id === 'string' || typeof row.external_id === 'number' ? String(row.external_id).trim() : '';
  if (!externalId || externalId.length > 200) return { error: 'missing external_id' };
  const commissionCents = toCents(row.commission);
  if (commissionCents == null) return { error: `bad commission for ${externalId}` };
  const status = normalizeStatus(row.status);
  if (!status) return { error: `unknown status "${String(row.status)}" for ${externalId}` };
  const occurred = new Date(String(row.occurred_at ?? ''));
  if (Number.isNaN(occurred.getTime())) return { error: `bad date for ${externalId}` };
  const currency = typeof row.currency === 'string' && /^[A-Za-z]{3}$/.test(row.currency.trim()) ? row.currency.trim().toUpperCase() : 'USD';
  const sub = typeof row.sub_id === 'string' ? row.sub_id.trim() : '';
  return {
    externalId,
    subId: sub || null,
    commissionCents,
    saleCents: row.sale == null || row.sale === '' ? null : toCents(row.sale),
    currency,
    status,
    occurredAt: occurred.toISOString(),
  };
}
