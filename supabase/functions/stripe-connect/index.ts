// POST { action: 'onboard', country } -> { url }   start or continue Stripe onboarding
// POST { action: 'status' } -> { hasAccount, detailsSubmitted, payoutsEnabled }
// POST { action: 'dashboard' } -> { url }           Stripe Express dashboard (payouts, tax info)
// Secret: STRIPE_SECRET_KEY. Stripe returns people to stripe-return, which
// sends them back into the app.
import { expressAccountParams, stripe, StripeError } from '../_shared/stripe.ts';
import { admin, callerId, json } from '../_shared/server.ts';

type Account = { id: string; details_submitted: boolean; payouts_enabled: boolean };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const uid = await callerId(req);
  if (!uid) return json(401, { error: 'not_authenticated' });
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return json(503, { error: 'payouts_not_configured' });
  let body: { action?: unknown; country?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }

  const { data: row } = await admin
    .from('creator_accounts')
    .select('stripe_account_id, country')
    .eq('profile_id', uid)
    .maybeSingle();
  const save = (a: Account, country: string) =>
    admin.rpc('save_creator_account', {
      p_profile_id: uid,
      p_stripe_account_id: a.id,
      p_country: country,
      p_details_submitted: a.details_submitted,
      p_payouts_enabled: a.payouts_enabled,
    });

  try {
    if (body.action === 'status') {
      if (!row) return json(200, { hasAccount: false, detailsSubmitted: false, payoutsEnabled: false });
      const a = await stripe<Account>(key, 'GET', `/accounts/${row.stripe_account_id}`);
      await save(a, row.country);
      return json(200, { hasAccount: true, detailsSubmitted: a.details_submitted, payoutsEnabled: a.payouts_enabled });
    }

    if (body.action === 'onboard') {
      let accountId = row?.stripe_account_id as string | undefined;
      if (!accountId) {
        const country = typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
        if (!/^[A-Z]{2}$/.test(country)) return json(400, { error: 'bad_country' });
        const a = await stripe<Account>(key, 'POST', '/accounts', expressAccountParams(country, uid), `acct-${uid}`);
        const { error } = await save(a, country);
        if (error) throw error;
        accountId = a.id;
      }
      const back = `${Deno.env.get('SUPABASE_URL')}/functions/v1/stripe-return`;
      const link = await stripe<{ url: string }>(key, 'POST', '/account_links', {
        account: accountId,
        type: 'account_onboarding',
        return_url: back,
        refresh_url: `${back}?refresh=1`,
      });
      return json(200, { url: link.url });
    }

    if (body.action === 'dashboard') {
      if (!row) return json(404, { error: 'no_payout_account' });
      const link = await stripe<{ url: string }>(key, 'POST', `/accounts/${row.stripe_account_id}/login_links`, {});
      return json(200, { url: link.url });
    }

    return json(400, { error: 'bad_request' });
  } catch (e) {
    console.error('stripe-connect', e);
    if (e instanceof StripeError && e.status < 500) {
      // Usually a country Stripe can't pay out to.
      return json(400, { error: 'stripe_rejected', detail: e.message });
    }
    return json(502, { error: 'payouts_failed' });
  }
});
