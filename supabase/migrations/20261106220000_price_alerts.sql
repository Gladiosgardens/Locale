-- Step 22: price-drop and back-in-stock alerts for wishlist items. A daily job
-- (check-prices) reads each saved item's product page and records its price;
-- a drop of 10% or more, or a return to stock, notifies everyone who saved it.

create table public.item_prices (
  item_id uuid primary key references public.items (id) on delete cascade,
  price_cents int check (price_cents > 0),
  currency text check (currency ~ '^[A-Z]{3}$'),
  in_stock boolean,
  checked_at timestamptz not null default now(),
  changed_at timestamptz,
  failures int not null default 0,
  constraint item_prices_price_currency check ((price_cents is null) = (currency is null))
);
alter table public.item_prices enable row level security;

alter table public.profile_private add column notify_price_alerts boolean not null default true;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('message', 'message_request', 'group_join_request', 'group_join_approved', 'new_follower',
                  'comment', 'reply', 'mention', 'comment_mention', 'tag',
                  'sale', 'first_sale', 'weekly_earnings', 'payout_sent', 'answer', 'answer_accepted',
                  'price_drop', 'back_in_stock'));

drop function public.set_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean);
create function public.set_notification_preferences(
  p_messages boolean default null,
  p_groups boolean default null,
  p_follows boolean default null,
  p_comments boolean default null,
  p_mentions boolean default null,
  p_earnings boolean default null,
  p_price_alerts boolean default null
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
      notify_earnings = coalesce(p_earnings, notify_earnings),
      notify_price_alerts = coalesce(p_price_alerts, notify_price_alerts)
  where profile_id = auth.uid()
$$;
revoke execute on function public.set_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- Saved items with a link that are due a check: never checked, or not for
-- 20 hours; pages that failed 5 times in a row are left alone.
create function public.items_to_check(p_limit int default 100)
returns table (item_id uuid, url text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.url
  from public.items i
  left join public.item_prices ip on ip.item_id = i.id
  where i.url is not null
    and exists (select 1 from public.saved_items s where s.item_id = i.id)
    and (ip.item_id is null or (ip.checked_at < now() - interval '20 hours' and ip.failures < 5))
  order by ip.checked_at nulls first
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- Records a successful read and tells savers about a drop or a restock.
-- The first read only sets the baseline. Returns 'drop', 'restock' or 'same'.
create function public.record_price(p_item_id uuid, p_price_cents int, p_currency text, p_in_stock boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  prev public.item_prices%rowtype;
  v_change text := 'same';
  v_title text;
begin
  select * into prev from public.item_prices where item_id = p_item_id for update;
  if found then
    if prev.in_stock is false and p_in_stock is true then
      v_change := 'restock';
    elsif prev.price_cents is not null and prev.currency = upper(p_currency) and p_price_cents <= prev.price_cents * 0.9 then
      v_change := 'drop';
    end if;
  end if;
  insert into public.item_prices (item_id, price_cents, currency, in_stock, checked_at, changed_at, failures)
  values (p_item_id, p_price_cents, upper(p_currency), p_in_stock, now(), null, 0)
  on conflict (item_id) do update
    set price_cents = excluded.price_cents, currency = excluded.currency, in_stock = coalesce(excluded.in_stock, public.item_prices.in_stock),
        checked_at = now(), failures = 0,
        changed_at = case when v_change <> 'same' then now() else public.item_prices.changed_at end;

  if v_change <> 'same' then
    select title into v_title from public.items where id = p_item_id;
    insert into public.notifications (recipient_id, kind, post_id, data)
    select s.profile_id, case v_change when 'drop' then 'price_drop' else 'back_in_stock' end, s.post_id,
           jsonb_build_object('item', v_title, 'old_cents', prev.price_cents, 'new_cents', p_price_cents,
                              'currency', upper(p_currency))
    from public.saved_items s
    join public.posts p on p.id = s.post_id
    where s.item_id = p_item_id
      and coalesce((select notify_price_alerts from public.profile_private where profile_id = s.profile_id), false)
      and (s.profile_id = p.author_id or public.may_notify_about_post(s.profile_id, p.author_id, s.post_id))
    on conflict (recipient_id, kind, post_id) where sent_at is null and post_id is not null
    do update set data = excluded.data;
  end if;
  return v_change;
end;
$$;

create function public.record_price_failure(p_item_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.item_prices (item_id, checked_at, failures) values (p_item_id, now(), 1)
  on conflict (item_id) do update set checked_at = now(), failures = public.item_prices.failures + 1
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.items_to_check(int)', 'public.record_price(uuid, int, text, boolean)',
                           'public.record_price_failure(uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- The wishlist shows the latest price and stock.
drop function public.my_saved_items(int, timestamptz);
create function public.my_saved_items(p_limit int default 30, p_before_created_at timestamptz default null)
returns table (
  item_id uuid,
  title text,
  brand text,
  store_name text,
  url text,
  url_host text,
  price_cents int,
  currency text,
  is_affiliate boolean,
  post_id uuid,
  photo_path text,
  saved_at timestamptz,
  current_price_cents int,
  current_currency text,
  in_stock boolean,
  price_changed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.title, i.brand, i.store_name, i.url, i.url_host, i.price_cents, i.currency, i.is_affiliate,
         s.post_id,
         (select m.storage_path from public.post_media m
          join public.item_tags t on t.post_media_id = m.id and t.item_id = i.id
          where m.post_id = s.post_id order by m.position limit 1),
         s.created_at,
         ip.price_cents, ip.currency, ip.in_stock, ip.changed_at
  from public.saved_items s
  join public.items i on i.id = s.item_id
  left join public.item_prices ip on ip.item_id = i.id
  where s.profile_id = auth.uid()
    and public.can_view_post(s.post_id)
    and (p_before_created_at is null or s.created_at < p_before_created_at)
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;
revoke execute on function public.my_saved_items(int, timestamptz) from public, anon;
grant execute on function public.my_saved_items(int, timestamptz) to authenticated;
