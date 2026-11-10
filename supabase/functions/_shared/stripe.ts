// Minimal Stripe API client (form-encoded REST), plain TypeScript for Jest.

type Params = { [key: string]: string | number | boolean | null | undefined | Params };

/** Stripe's form encoding: nested objects become key[sub]=value. */
export function formEncode(params: Params, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') {
      const inner = formEncode(v, key);
      if (inner) parts.push(inner);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join('&');
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function stripe<T>(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  params?: Params,
  idempotencyKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const body = params && method === 'POST' ? formEncode(params) : undefined;
  const res = await fetchImpl(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body,
  });
  const json = (await res.json()) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) throw new StripeError(json.error?.message ?? `stripe ${res.status}`, res.status, json.error?.code);
  return json;
}

/**
 * An Express account that can receive transfers. Outside the US, Stripe's
 * "recipient" agreement lets a US platform pay people in other countries.
 */
export function expressAccountParams(country: string, profileId: string): Params {
  const upper = country.toUpperCase();
  return {
    type: 'express',
    country: upper,
    business_type: 'individual',
    capabilities: { transfers: { requested: true } },
    ...(upper === 'US' ? {} : { tos_acceptance: { service_agreement: 'recipient' } }),
    metadata: { profile_id: profileId },
  };
}
