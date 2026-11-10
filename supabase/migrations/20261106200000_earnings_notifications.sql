-- Step 20: earnings notifications. A push when someone buys through your
-- post (a celebration for the very first one), when a payout is sent, and a
-- weekly "you earned $X" summary.

alter table public.notifications add column data jsonb;
alter table public.commissions add column created_at timestamptz not null default now();
alter table public.profile_private add column notify_earnings boolean not null default true;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('message', 'message_request', 'group_join_request', 'group_join_approved', 'new_follower',
                  'comment', 'reply', 'mention', 'comment_mention', 'tag',
                  'sale', 'first_sale', 'weekly_earnings', 'payout_sent'));

drop function public.set_notification_preferences(boolean, boolean, boolean, boolean, boolean);
create function public.set_notification_preferences(
  p_messages boolean default null,
  p_groups boolean default null,
  p_follows boolean default null,
  p_comments boolean default null,
  p_mentions boolean default null,
  p_earnings boolean default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profile_private
  set notify_messages = coalesce(p_messages, notify_messages),
      notify_groups = coalesce(p_groups, notify_groups),
      notify_follows = coalesce(p_follows, notify_follows),
      notify_comments = coalesce(p_comments, notify_comments),
      notify_mentions = coalesce(p_mentions, notify_mentions),
      notify_earnings = coalesce(p_earnings, notify_earnings)
  where profile_id = auth.uid()
$$;
revoke execute on function public.set_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

create function public.wants_earnings_pushes(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select notify_earnings from public.profile_private where profile_id = p_profile_id), false)
$$;
revoke execute on function public.wants_earnings_pushes(uuid) from public, anon, authenticated;

-- One push per sale; several sales on a post before the push goes out add up.
-- The first credited sale ever gets its own celebratory push.
create function public.notify_sale(p_poster uuid, p_post uuid, p_item uuid, p_cents int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first boolean;
  v_title text := (select title from public.items where id = p_item);
begin
  if p_poster is null or not public.wants_earnings_pushes(p_poster) then
    return;
  end if;
  v_first := (select count(*) from public.commissions where poster_id = p_poster and creator_cents > 0) = 1;
  if v_first then
    insert into public.notifications (recipient_id, kind, post_id, data)
    values (p_poster, 'first_sale', null, jsonb_build_object('cents', p_cents, 'item', v_title));
    return;
  end if;
  insert into public.notifications (recipient_id, kind, post_id, data)
  values (p_poster, 'sale', p_post, jsonb_build_object('cents', p_cents, 'count', 1, 'item', v_title))
  on conflict (recipient_id, kind, post_id) where sent_at is null and post_id is not null
  do update set data = jsonb_build_object(
    'cents', coalesce((public.notifications.data ->> 'cents')::int, 0) + p_cents,
    'count', coalesce((public.notifications.data ->> 'count')::int, 1) + 1,
    'item', excluded.data ->> 'item');
end;
$$;
revoke execute on function public.notify_sale(uuid, uuid, uuid, int) from public, anon, authenticated;

create or replace function public.import_commission(
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
    if v_bps > 0 and p_status <> 'reversed' then
      perform public.notify_sale(v_click.poster_id, v_click.post_id, v_click.item_id,
                                 (p_commission_cents::bigint * v_bps / 10000)::int);
    end if;
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

create or replace function public.complete_payout(p_payout_id uuid, p_transfer_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_cents int;
begin
  update public.payouts set status = 'paid', stripe_transfer_id = p_transfer_id, completed_at = now()
  where id = p_payout_id and status = 'processing'
  returning profile_id, amount_cents into v_profile, v_cents;
  if v_profile is not null and public.wants_earnings_pushes(v_profile) then
    insert into public.notifications (recipient_id, kind, data)
    values (v_profile, 'payout_sent', jsonb_build_object('cents', v_cents));
  end if;
end;
$$;

-- Run weekly (pg_cron): everyone whose credited sales in the past 7 days add
-- up to more than zero gets "You earned $X from N sales this week".
create function public.weekly_earnings_digest()
returns int
language sql
security definer
set search_path = ''
as $$
  with week as (
    select c.poster_id, sum(c.creator_cents)::int as cents, count(*)::int as sales
    from public.commissions c
    where c.creator_cents > 0 and c.status <> 'reversed' and c.created_at > now() - interval '7 days'
    group by c.poster_id
  ),
  sent as (
    insert into public.notifications (recipient_id, kind, data)
    select w.poster_id, 'weekly_earnings', jsonb_build_object('cents', w.cents, 'count', w.sales)
    from week w
    where w.cents > 0 and public.wants_earnings_pushes(w.poster_id)
    returning 1
  )
  select count(*)::int from sent
$$;
revoke execute on function public.weekly_earnings_digest() from public, anon, authenticated;
grant execute on function public.weekly_earnings_digest() to service_role;

-- Delivery now also reads each notification's data (amounts, item names).
drop function public.claim_notifications(int);
create function public.claim_notifications(p_limit int default 100)
returns table (
  id bigint,
  kind text,
  actor_id uuid,
  actor_name text,
  group_name text,
  conversation_id uuid,
  group_id uuid,
  post_id uuid,
  data jsonb,
  tokens text[]
)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select n.id from public.notifications n
    where n.sent_at is null and (n.claimed_at is null or n.claimed_at < now() - interval '5 minutes')
    order by n.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  ),
  claimed as (
    update public.notifications n set claimed_at = now()
    from picked where n.id = picked.id
    returning n.*
  )
  select c.id, c.kind, c.actor_id, a.display_name, g.name, c.conversation_id, c.group_id, c.post_id, c.data,
         coalesce((select array_agg(t.token order by t.last_seen_at desc)
                   from public.push_tokens t where t.profile_id = c.recipient_id), '{}')
  from claimed c
  left join public.profiles a on a.id = c.actor_id
  left join public.groups g on g.id = c.group_id
  order by c.id
$$;
revoke execute on function public.claim_notifications(int) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
