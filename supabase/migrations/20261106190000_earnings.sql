-- Step 19: creator earnings. Anyone can earn a share of the affiliate
-- commission when someone buys through a link they tagged.
--
-- Flow: tapping Shop records an affiliate_click (its id travels with the link
-- as the network's custom/sub ID) -> the network reports a sale with that ID
-- -> import_commission records it and credits the poster 70% -> once the
-- retailer's return window closes the network "locks" it -> on the 1st of each
-- month, posters with at least $25 available and a ready Stripe account are
-- paid by Stripe transfer.
--
-- Not credited: buying through your own post, and links the poster already
-- marked as their own affiliate links (they earn through their own program).

create table public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  poster_id uuid references public.profiles (id) on delete set null,
  clicker_id uuid references public.profiles (id) on delete set null,
  credit_poster boolean not null,
  created_at timestamptz not null default now()
);
create index affiliate_clicks_clicker on public.affiliate_clicks (clicker_id, created_at desc);
alter table public.affiliate_clicks enable row level security;

create table public.creator_accounts (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  country text not null check (country ~ '^[A-Z]{2}$'),
  details_submitted boolean not null default false,
  payouts_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.creator_accounts enable row level security;

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  stripe_account_id text not null,
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'USD',
  status text not null default 'processing' check (status in ('processing', 'paid', 'failed')),
  stripe_transfer_id text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index payouts_profile on public.payouts (profile_id, created_at desc);
alter table public.payouts enable row level security;

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  network text not null check (network ~ '^[a-z0-9_-]{2,30}$'),
  external_id text not null check (char_length(external_id) between 1 and 200),
  click_id uuid references public.affiliate_clicks (id) on delete set null,
  poster_id uuid references public.profiles (id) on delete set null,
  post_id uuid references public.posts (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  commission_cents int not null check (commission_cents >= 0),
  sale_cents int check (sale_cents is null or sale_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- The poster's share in basis points when credited (7000 = 70%), kept per row
  -- so a later change of rate doesn't rewrite history.
  creator_share_bps int not null default 0 check (creator_share_bps between 0 and 10000),
  creator_cents int not null default 0 check (creator_cents >= 0),
  status text not null check (status in ('pending', 'locked', 'reversed')),
  occurred_at timestamptz not null,
  locked_at timestamptz,
  -- Paid out in this payout (locked commissions).
  payout_id uuid references public.payouts (id),
  -- A commission reversed after it was paid is taken back from this payout.
  clawback_payout_id uuid references public.payouts (id),
  updated_at timestamptz not null default now(),
  unique (network, external_id)
);
create index commissions_poster on public.commissions (poster_id, occurred_at desc);
alter table public.commissions enable row level security;
-- No client policies on any of these: reads go through my_* functions, writes
-- through the service role.

-- The share is a setting so it can change for new sales only.
create function public.creator_share_bps()
returns int
language sql
immutable
set search_path = ''
as $$ select 7000 $$;

------------------------------------------------------------------------------
-- Clicks
------------------------------------------------------------------------------

-- Called (through shop-link) when someone taps Shop on a tagged item. Returns
-- the click id to send as the network's custom ID, the item's link, and whether
-- it's the poster's own affiliate link (left untouched).
create function public.start_shop_click(p_post_id uuid, p_item_id uuid)
returns table (click_id uuid, url text, own_affiliate boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_url text;
  v_affiliate boolean;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select p.author_id into v_author from public.posts p where p.id = p_post_id;
  if v_author is null or not public.can_view_post(p_post_id) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  select it.url, it.is_affiliate into v_url, v_affiliate
  from public.items it
  join public.item_tags t on t.item_id = it.id
  join public.post_media m on m.id = t.post_media_id
  where m.post_id = p_post_id and it.id = p_item_id
  limit 1;
  if v_url is null then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.affiliate_clicks c
      where c.clicker_id = v_uid and c.created_at > now() - interval '24 hours') >= 300 then
    -- Past the limit the link still opens, just without tracking.
    return query select null::uuid, v_url, v_affiliate;
    return;
  end if;
  insert into public.affiliate_clicks (post_id, item_id, poster_id, clicker_id, credit_poster)
  values (p_post_id, p_item_id, v_author, v_uid, v_uid <> v_author and not v_affiliate)
  returning id into v_id;
  return query select v_id, v_url, v_affiliate;
end;
$$;
revoke execute on function public.start_shop_click(uuid, uuid) from public, anon;
grant execute on function public.start_shop_click(uuid, uuid) to authenticated;

------------------------------------------------------------------------------
-- Commissions (service role: import-commissions)
------------------------------------------------------------------------------

-- Records or updates one sale reported by a network. p_sub_id is the custom ID
-- the link carried (our click id). Returns 'credited', 'locale' (Locale keeps
-- it all) or 'unchanged'.
create function public.import_commission(
  p_network text,
  p_external_id text,
  p_sub_id text,
  p_commission_cents int,
  p_sale_cents int,
  p_currency text,
  p_status text,
  p_occurred_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_click public.affiliate_clicks%rowtype;
  v_existing public.commissions%rowtype;
  v_click_id uuid;
  v_bps int;
begin
  if p_status not in ('pending', 'locked', 'reversed') then
    raise exception 'bad_status' using errcode = '22023';
  end if;
  begin
    v_click_id := nullif(btrim(coalesce(p_sub_id, '')), '')::uuid;
  exception when invalid_text_representation then
    v_click_id := null;
  end;
  select * into v_click from public.affiliate_clicks where id = v_click_id;

  select * into v_existing from public.commissions where network = p_network and external_id = p_external_id for update;
  if not found then
    v_bps := case when v_click.credit_poster and v_click.poster_id is not null then public.creator_share_bps() else 0 end;
    insert into public.commissions (network, external_id, click_id, poster_id, post_id, item_id, commission_cents, sale_cents,
                                    currency, creator_share_bps, creator_cents, status, occurred_at, locked_at)
    values (p_network, p_external_id, v_click.id, case when v_bps > 0 then v_click.poster_id end, v_click.post_id, v_click.item_id,
            p_commission_cents, p_sale_cents, upper(coalesce(p_currency, 'USD')), v_bps,
            (p_commission_cents::bigint * v_bps / 10000)::int, p_status, p_occurred_at,
            case when p_status = 'locked' then now() end);
    return case when v_bps > 0 then 'credited' else 'locale' end;
  end if;

  -- Paid commissions can only be reversed (taken back from a later payout).
  if v_existing.payout_id is not null and p_status <> 'reversed' then
    return 'unchanged';
  end if;
  if v_existing.status = p_status and v_existing.commission_cents = p_commission_cents then
    return 'unchanged';
  end if;
  update public.commissions
  set status = p_status,
      commission_cents = case when payout_id is null then p_commission_cents else commission_cents end,
      sale_cents = coalesce(p_sale_cents, sale_cents),
      creator_cents = case when payout_id is null
                           then (p_commission_cents::bigint * creator_share_bps / 10000)::int else creator_cents end,
      locked_at = case when p_status = 'locked' then coalesce(locked_at, now()) else locked_at end,
      updated_at = now()
  where id = v_existing.id;
  return case when v_existing.creator_share_bps > 0 then 'credited' else 'locale' end;
end;
$$;
revoke execute on function public.import_commission(text, text, text, int, int, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.import_commission(text, text, text, int, int, text, text, timestamptz) to service_role;

------------------------------------------------------------------------------
-- Balances
------------------------------------------------------------------------------

-- Available = locked credited commissions not yet paid, minus paid ones that
-- were later reversed and not yet taken back. Pending = not locked yet.
create function public.creator_balances(p_profile_id uuid)
returns table (pending_cents int, available_cents int, paid_cents int)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(creator_cents) filter (where status = 'pending'), 0)::int,
    (coalesce(sum(creator_cents) filter (where status = 'locked' and payout_id is null), 0)
     - coalesce(sum(creator_cents) filter (where status = 'reversed' and payout_id is not null and clawback_payout_id is null), 0))::int,
    (select coalesce(sum(p.amount_cents), 0)::int from public.payouts p where p.profile_id = p_profile_id and p.status = 'paid')
  from public.commissions
  where poster_id = p_profile_id and creator_cents > 0
$$;
revoke execute on function public.creator_balances(uuid) from public, anon, authenticated;

create function public.my_earnings_summary()
returns table (
  pending_cents int,
  available_cents int,
  paid_cents int,
  share_percent int,
  minimum_payout_cents int,
  next_payout_on date,
  has_account boolean,
  details_submitted boolean,
  payouts_enabled boolean,
  country text
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.pending_cents, b.available_cents, b.paid_cents,
         public.creator_share_bps() / 100, 2500,
         (date_trunc('month', now() at time zone 'utc') + interval '1 month')::date,
         a.profile_id is not null, coalesce(a.details_submitted, false), coalesce(a.payouts_enabled, false), a.country
  from public.creator_balances(auth.uid()) b
  left join public.creator_accounts a on a.profile_id = auth.uid()
  where auth.uid() is not null
$$;

-- Sales through my links, newest first.
create function public.my_commissions(p_limit int default 30, p_before timestamptz default null)
returns table (
  id uuid,
  occurred_at timestamptz,
  status text,
  creator_cents int,
  sale_cents int,
  currency text,
  post_id uuid,
  item_title text,
  post_media_path text,
  post_playback_id text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.occurred_at,
         case when c.status = 'reversed' then 'reversed'
              when c.payout_id is not null then (select case p.status when 'paid' then 'paid' else 'processing' end
                                                  from public.payouts p where p.id = c.payout_id)
              when c.status = 'locked' then 'available'
              else 'pending' end,
         c.creator_cents, c.sale_cents, c.currency, c.post_id, it.title,
         pm.storage_path, pm.mux_playback_id
  from public.commissions c
  left join public.items it on it.id = c.item_id
  left join public.post_media pm on pm.post_id = c.post_id and pm.position = 0
  where c.poster_id = auth.uid() and c.creator_cents > 0
    and (p_before is null or c.occurred_at < p_before)
  order by c.occurred_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

create function public.my_payouts()
returns table (id uuid, amount_cents int, currency text, status text, created_at timestamptz, completed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.amount_cents, p.currency, p.status, p.created_at, p.completed_at
  from public.payouts p where p.profile_id = auth.uid()
  order by p.created_at desc limit 50
$$;

-- Sales and earnings for one of my posts (shown in Post insights).
create function public.post_earnings(p_post_id uuid)
returns table (sales int, earned_cents int)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) filter (where c.status <> 'reversed')::int,
         coalesce(sum(c.creator_cents) filter (where c.status <> 'reversed'), 0)::int
  from public.commissions c
  where c.post_id = p_post_id and c.poster_id = auth.uid()
$$;

revoke execute on function public.my_earnings_summary() from public, anon;
revoke execute on function public.my_commissions(int, timestamptz) from public, anon;
revoke execute on function public.my_payouts() from public, anon;
revoke execute on function public.post_earnings(uuid) from public, anon;
grant execute on function public.my_earnings_summary() to authenticated;
grant execute on function public.my_commissions(int, timestamptz) to authenticated;
grant execute on function public.my_payouts() to authenticated;
grant execute on function public.post_earnings(uuid) to authenticated;

------------------------------------------------------------------------------
-- Stripe accounts and payouts (service role: stripe-connect, run-payouts)
------------------------------------------------------------------------------

create function public.save_creator_account(
  p_profile_id uuid,
  p_stripe_account_id text,
  p_country text,
  p_details_submitted boolean,
  p_payouts_enabled boolean
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.creator_accounts (profile_id, stripe_account_id, country, details_submitted, payouts_enabled)
  values (p_profile_id, p_stripe_account_id, upper(p_country), p_details_submitted, p_payouts_enabled)
  on conflict (profile_id) do update
    set details_submitted = excluded.details_submitted,
        payouts_enabled = excluded.payouts_enabled,
        updated_at = now()
$$;

-- Everyone due a payout: a ready Stripe account and at least p_min_cents available.
create function public.payable_creators(p_min_cents int default 2500)
returns table (profile_id uuid, stripe_account_id text, available_cents int)
language sql
stable
security definer
set search_path = ''
as $$
  select a.profile_id, a.stripe_account_id, b.available_cents
  from public.creator_accounts a
  cross join lateral public.creator_balances(a.profile_id) b
  where a.payouts_enabled and b.available_cents >= p_min_cents
$$;

-- Reserves everything currently available for one creator in a new payout.
-- Returns null if there's no longer enough (e.g. a reversal came in).
create function public.begin_payout(p_profile_id uuid, p_min_cents int default 2500)
returns table (payout_id uuid, stripe_account_id text, amount_cents int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_account text;
  v_amount int;
  v_id uuid;
begin
  select a.stripe_account_id into v_account from public.creator_accounts a
  where a.profile_id = p_profile_id and a.payouts_enabled for update;
  if v_account is null then
    return;
  end if;
  perform 1 from public.commissions where poster_id = p_profile_id for update;
  select b.available_cents into v_amount from public.creator_balances(p_profile_id) b;
  if coalesce(v_amount, 0) < p_min_cents then
    return;
  end if;
  insert into public.payouts (profile_id, stripe_account_id, amount_cents)
  values (p_profile_id, v_account, v_amount) returning id into v_id;
  update public.commissions set payout_id = v_id, updated_at = now()
  where poster_id = p_profile_id and creator_cents > 0 and status = 'locked' and payout_id is null;
  update public.commissions set clawback_payout_id = v_id, updated_at = now()
  where poster_id = p_profile_id and creator_cents > 0 and status = 'reversed'
    and payout_id is not null and clawback_payout_id is null;
  return query select v_id, v_account, v_amount;
end;
$$;

create function public.complete_payout(p_payout_id uuid, p_transfer_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payouts set status = 'paid', stripe_transfer_id = p_transfer_id, completed_at = now()
  where id = p_payout_id and status = 'processing'
$$;

-- A failed transfer releases everything back to available for next time.
create function public.fail_payout(p_payout_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payouts set status = 'failed', error = left(p_error, 500), completed_at = now()
  where id = p_payout_id and status = 'processing';
  if found then
    update public.commissions set payout_id = null, updated_at = now() where payout_id = p_payout_id and status = 'locked';
    update public.commissions set clawback_payout_id = null, updated_at = now() where clawback_payout_id = p_payout_id;
  end if;
end;
$$;

-- A reversal can arrive while a payout is processing; that commission stays
-- in the payout (paid) and is taken back next time, like any paid reversal.

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.save_creator_account(uuid, text, text, boolean, boolean)',
    'public.payable_creators(int)', 'public.begin_payout(uuid, int)',
    'public.complete_payout(uuid, text)', 'public.fail_payout(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- Payout rows must survive account deletion for accounting; deleting a profile
-- with payouts is blocked (on delete restrict) until the account-deletion flow
-- anonymizes them.
