// POST (monthly, from cron): pays everyone with at least $25 available and a
// ready Stripe account, by Stripe transfer to their connected account.
// Header x-payout-secret must match PAYOUT_SECRET; also needs STRIPE_SECRET_KEY.
// Deploy with --no-verify-jwt. Safe to re-run: transfers use the payout id as
// idempotency key, and balances already reserved aren't paid twice.
import { safeEqual } from '../_shared/push.ts';
import { stripe } from '../_shared/stripe.ts';
import { admin, json } from '../_shared/server.ts';

const MIN_CENTS = 2500;

Deno.serve(async (req) => {
  const secret = Deno.env.get('PAYOUT_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-payout-secret') ?? '', secret)) return json(403, { error: 'forbidden' });
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return json(503, { error: 'payouts_not_configured' });

  const { data: due, error } = await admin.rpc('payable_creators', { p_min_cents: MIN_CENTS });
  if (error) return json(500, { error: error.message });

  const result = { paid: 0, failed: 0, totalCents: 0 };
  for (const c of due as { profile_id: string }[]) {
    const { data: started } = await admin.rpc('begin_payout', { p_profile_id: c.profile_id, p_min_cents: MIN_CENTS });
    const p = (started as { payout_id: string; stripe_account_id: string; amount_cents: number }[] | null)?.[0];
    if (!p) continue;
    try {
      const transfer = await stripe<{ id: string }>(
        key,
        'POST',
        '/transfers',
        {
          amount: p.amount_cents,
          currency: 'usd',
          destination: p.stripe_account_id,
          description: 'Locale creator earnings',
          metadata: { payout_id: p.payout_id, profile_id: c.profile_id },
        },
        `payout-${p.payout_id}`,
      );
      await admin.rpc('complete_payout', { p_payout_id: p.payout_id, p_transfer_id: transfer.id });
      result.paid += 1;
      result.totalCents += p.amount_cents;
    } catch (e) {
      console.error('run-payouts', p.payout_id, e);
      await admin.rpc('fail_payout', { p_payout_id: p.payout_id, p_error: e instanceof Error ? e.message : String(e) });
      result.failed += 1;
    }
  }
  return json(200, result);
});
