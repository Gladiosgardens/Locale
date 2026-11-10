// GET: where Stripe sends people after onboarding. Redirects into the app
// (locale://earnings), which re-checks the account. Deploy with --no-verify-jwt.
Deno.serve((req) => {
  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  return new Response(null, {
    status: 302,
    headers: { Location: refresh ? 'locale://earnings?refresh=1' : 'locale://earnings' },
  });
});
