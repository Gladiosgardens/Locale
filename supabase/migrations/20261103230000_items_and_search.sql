-- Core-loop step 4: shoppable item tags on photos, plus public discovery:
-- an "Everywhere" feed and item search that reach beyond the nearby area.
--
-- Authors tag items while composing a post. Tags and items are created in the
-- same transaction as the post (via create_post_record) and are visible exactly
-- when the post is: item_tags -> post_media -> posts RLS, items -> item_tags.
--
-- Links are validated here, not just in the app: https only, ASCII host names,
-- no IP literals or user@host tricks, no link shorteners. The displayed domain
-- (url_host) is derived by the server.
--
-- Public visibility: a post can be discovered from anywhere when it
-- is published, its author left "searchable" on, and it carries no
-- kid-related interest tag. Far-away searchers get the photo, items and the
-- poster's handle, never the poster's area. Everything else stays nearby-only.

------------------------------------------------------------------------------
-- Posts: author opt-out from everywhere-search
------------------------------------------------------------------------------

alter table public.posts add column searchable boolean not null default true;
-- The Everywhere feed reads all published posts newest-first.
create index posts_published_idx on public.posts (published_at desc, id desc)
  where status = 'published';

------------------------------------------------------------------------------
-- Link validation
------------------------------------------------------------------------------

-- Returns the lower-cased host of a shoppable link, or raises.
create function public.item_url_host(p_url text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_authority text;
  v_host text;
begin
  if char_length(p_url) > 2000 or p_url ~ '\s' then
    raise exception 'invalid_url' using errcode = '22023';
  end if;
  v_authority := substring(p_url from '^https://([^/?#]*)');
  if v_authority is null or v_authority = '' or position('@' in v_authority) > 0 then
    raise exception 'invalid_url' using errcode = '22023';
  end if;
  -- Allow an explicit port, but nothing else after the host.
  v_host := lower(regexp_replace(v_authority, ':[0-9]{1,5}$', ''));
  v_host := regexp_replace(v_host, '\.$', '');
  if v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$' then
    -- Rejects IP literals (last label must start with a letter), Unicode
    -- (use punycode), single-label hosts and malformed names.
    raise exception 'invalid_url' using errcode = '22023';
  end if;
  if v_host in (
    'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly',
    'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 't.ly', 'lnkd.in', 'trib.al', 's.id',
    'v.gd', 'bl.ink', 'short.io', 'amzn.to', 'a.co'
  ) then
    raise exception 'shortened_url' using errcode = '22023';
  end if;
  return v_host;
end;
$$;

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.items (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  title text not null check (title = btrim(title) and char_length(title) between 1 and 80),
  brand text check (brand = btrim(brand) and char_length(brand) between 1 and 60),
  store_name text check (store_name = btrim(store_name) and char_length(store_name) between 1 and 60),
  url text,
  url_host text,
  price_cents int check (price_cents between 0 and 100000000),
  currency text check (currency ~ '^[A-Z]{3}$'),
  is_affiliate boolean not null default false,
  created_at timestamptz not null default now(),
  constraint items_price_currency check ((price_cents is null) = (currency is null)),
  constraint items_url_host check (url_host is not distinct from public.item_url_host(url)),
  constraint items_affiliate_needs_url check (not is_affiliate or url is not null),
  search tsvector generated always as (
    to_tsvector('simple', title || ' ' || coalesce(brand, '') || ' ' || coalesce(store_name, ''))
  ) stored
);
create index items_created_by_idx on public.items (created_by);
create index items_search_idx on public.items using gin (search);

create table public.item_tags (
  id uuid primary key default gen_random_uuid(),
  post_media_id uuid not null references public.post_media (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  x real not null check (x between 0 and 1),
  y real not null check (y between 0 and 1),
  unique (post_media_id, item_id)
);
create index item_tags_item_idx on public.item_tags (item_id);

------------------------------------------------------------------------------
-- Privileges and RLS
------------------------------------------------------------------------------

alter table public.items enable row level security;
alter table public.item_tags enable row level security;

revoke all on public.items, public.item_tags from anon, authenticated;
grant select on public.items, public.item_tags to authenticated;

-- post_media RLS (and through it posts RLS) applies inside these subqueries.
create policy "read tags on visible media"
  on public.item_tags for select
  to authenticated
  using (exists (select 1 from public.post_media m where m.id = item_tags.post_media_id));

create policy "read items tagged on visible media"
  on public.items for select
  to authenticated
  using (exists (select 1 from public.item_tags t where t.item_id = items.id));

------------------------------------------------------------------------------
-- create_post_record, now with tags
------------------------------------------------------------------------------

drop function public.create_post_record(uuid, uuid, text, smallint[], jsonb);

-- p_tags: [{ "media": <index into p_media>, "x": 0..1, "y": 0..1,
--            "item": { "title", "brand"?, "store_name"?, "url"?,
--                      "price_cents"?, "currency"?, "is_affiliate"? } }]
create function public.create_post_record(
  p_post_id uuid,
  p_author_id uuid,
  p_caption text,
  p_interest_ids smallint[],
  p_media jsonb,
  p_tags jsonb default '[]'::jsonb,
  p_searchable boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area uuid;
  v_ids smallint[];
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  v_count int := jsonb_array_length(coalesce(p_media, '[]'::jsonb));
  v_tag_count int := jsonb_array_length(coalesce(p_tags, '[]'::jsonb));
  v_media_ids uuid[] := '{}';
  v_media_id uuid;
  v_item_id uuid;
  v_item jsonb;
  v_url text;
  m jsonb;
  t jsonb;
  v_index int;
  i int := 0;
begin
  select pp.area_id into v_area
  from public.profile_private pp
  join public.profiles p on p.id = pp.profile_id
  where pp.profile_id = p_author_id and p.onboarded_at is not null;
  if v_area is null then
    raise exception 'not_onboarded' using errcode = '22023';
  end if;

  if (select count(*) from public.posts
      where author_id = p_author_id and published_at > now() - interval '24 hours') >= 20 then
    raise exception 'post_rate_limited' using errcode = 'P0001';
  end if;

  if v_count not between 1 and 10 then
    raise exception 'media_count' using errcode = '22023';
  end if;
  if v_tag_count > 20 then
    raise exception 'too_many_tags' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids
  from unnest(coalesce(p_interest_ids, '{}')) as x;
  if cardinality(v_ids) > 3 then
    raise exception 'too_many_interests' using errcode = '22023';
  end if;
  if (select count(*) from public.interests where id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'unknown_interest' using errcode = '22023';
  end if;

  insert into public.posts (id, author_id, area_id, caption, searchable)
  values (p_post_id, p_author_id, v_area, v_caption, coalesce(p_searchable, true));

  for m in select value from jsonb_array_elements(p_media) loop
    if m ->> 'path' is distinct from p_post_id::text || '/' || i || '.jpg' then
      raise exception 'bad_media_path' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'post-media' and o.name = m ->> 'path'
    ) then
      raise exception 'media_missing' using errcode = '22023';
    end if;
    insert into public.post_media (post_id, storage_path, width, height, position)
    values (p_post_id, m ->> 'path', (m ->> 'width')::int, (m ->> 'height')::int, i)
    returning id into v_media_id;
    v_media_ids := v_media_ids || v_media_id;
    i := i + 1;
  end loop;

  insert into public.post_interests (post_id, interest_id)
  select p_post_id, x from unnest(v_ids) as x;

  for t in select value from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb)) loop
    begin
      v_index := (t ->> 'media')::int;
      v_item := t -> 'item';
      if v_index is null or v_index < 0 or v_index >= v_count or jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid_tag' using errcode = '22023';
      end if;
      v_url := nullif(btrim(coalesce(v_item ->> 'url', '')), '');

      insert into public.items (created_by, title, brand, store_name, url, url_host,
                                price_cents, currency, is_affiliate)
      values (
        p_author_id,
        btrim(v_item ->> 'title'),
        nullif(btrim(coalesce(v_item ->> 'brand', '')), ''),
        nullif(btrim(coalesce(v_item ->> 'store_name', '')), ''),
        v_url,
        case when v_url is null then null else public.item_url_host(v_url) end,
        (v_item ->> 'price_cents')::int,
        upper(nullif(btrim(coalesce(v_item ->> 'currency', '')), '')),
        coalesce((v_item ->> 'is_affiliate')::boolean, false)
      )
      returning id into v_item_id;

      insert into public.item_tags (post_media_id, item_id, x, y)
      values (v_media_ids[v_index + 1], v_item_id, (t ->> 'x')::real, (t ->> 'y')::real);
    exception
      when check_violation or not_null_violation or invalid_text_representation
           or numeric_value_out_of_range then
        raise exception 'invalid_tag' using errcode = '22023';
    end;
  end loop;

  if exists (
    select 1 from public.item_tags tg
    join public.post_media pm on pm.id = tg.post_media_id
    where pm.post_id = p_post_id
    group by tg.post_media_id having count(*) > 5
  ) then
    raise exception 'too_many_tags' using errcode = '22023';
  end if;

  return p_post_id;
end;
$$;
revoke execute on function public.create_post_record(uuid, uuid, text, smallint[], jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.create_post_record(uuid, uuid, text, smallint[], jsonb, jsonb, boolean)
  to service_role;

------------------------------------------------------------------------------
-- Feed: include each photo's tags
------------------------------------------------------------------------------

create or replace function public.nearby_feed(
  p_limit int default 20,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null,
  p_interest_id smallint default null
)
returns table (
  id uuid,
  caption text,
  published_at timestamptz,
  author_id uuid,
  author_handle text,
  author_display_name text,
  area_name text,
  media jsonb,
  interest_ids smallint[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.caption,
    p.published_at,
    p.author_id,
    pr.handle,
    pr.display_name,
    a.name,
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'path', m.storage_path,
                  'width', m.width,
                  'height', m.height,
                  'tags', coalesce(
                    (select jsonb_agg(
                              jsonb_build_object(
                                'id', t.id, 'x', t.x, 'y', t.y,
                                'item', jsonb_build_object(
                                  'id', it.id, 'title', it.title, 'brand', it.brand,
                                  'store_name', it.store_name, 'url', it.url,
                                  'url_host', it.url_host, 'price_cents', it.price_cents,
                                  'currency', it.currency, 'is_affiliate', it.is_affiliate))
                              order by t.y, t.x)
                     from public.item_tags t
                     join public.items it on it.id = t.item_id
                     where t.post_media_id = m.id),
                    '[]'::jsonb))
                order by m.position)
       from public.post_media m where m.post_id = p.id),
      '[]'::jsonb),
    coalesce(
      (select array_agg(pi.interest_id order by pi.interest_id)
       from public.post_interests pi where pi.post_id = p.id),
      '{}'::smallint[])
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  join public.areas a on a.id = p.area_id
  where (p_before_published_at is null
         or (p.published_at, p.id) < (p_before_published_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    and (p_interest_id is null
         or exists (select 1 from public.post_interests pi
                    where pi.post_id = p.id and pi.interest_id = p_interest_id))
  order by p.published_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

------------------------------------------------------------------------------
-- Search visibility
------------------------------------------------------------------------------

-- True when anyone signed in may find this post through item search.
create function public.post_is_globally_searchable(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and p.status = 'published'
      and p.searchable
      and not exists (
        select 1 from public.post_interests pi
        join public.interests i on i.id = pi.interest_id
        where pi.post_id = p.id and i.is_family
      )
  )
$$;
revoke execute on function public.post_is_globally_searchable(uuid) from public, anon, authenticated;

-- Images: readable when the post is visible nearby (posts RLS through
-- post_media) or the post is globally searchable.
create function public.can_view_post_media(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.post_media m
    join public.posts p on p.id = m.post_id
    where m.storage_path = p_path
      and p.status = 'published'
      and (
        p.author_id = auth.uid()
        or p.area_id in (select public.my_nearby_area_ids())
        or public.post_is_globally_searchable(p.id)
      )
  )
$$;
revoke execute on function public.can_view_post_media(text) from public, anon;
grant execute on function public.can_view_post_media(text) to authenticated;

drop policy "read media of visible posts" on storage.objects;
create policy "read media of visible or searchable posts"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'post-media' and public.can_view_post_media(objects.name));

------------------------------------------------------------------------------
-- Discovery: Everywhere feed and item search
------------------------------------------------------------------------------

-- Without p_query: every post the caller may see (nearby, own, or globally
-- searchable), newest first. With p_query: only posts with an item matching
-- every word (prefix match on title, brand and store). Keyset-paginated.
-- Security definer so it can reach posts outside the caller's area; it applies
-- the visibility rule itself and returns area_name only for nearby posts.
-- posts RLS stays nearby-only, so direct table reads never expose far areas.
create function public.discover_posts(
  p_query text default null,
  p_limit int default 20,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  caption text,
  published_at timestamptz,
  author_id uuid,
  author_handle text,
  author_display_name text,
  area_name text,
  media jsonb,
  interest_ids smallint[],
  matched_item_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_query tsquery;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_query is not null then
    select to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' & '))
    into v_query
    from (
      select w from regexp_split_to_table(lower(p_query), '[^[:alnum:]]+') as w
      where char_length(w) >= 2
      limit 6
    ) words;
    if v_query is null then
      raise exception 'query_too_short' using errcode = '22023';
    end if;
  end if;

  return query
  with nearby as (select public.my_nearby_area_ids() as area_id),
  matches as (
    select pm.post_id, array_agg(distinct it.id) as item_ids
    from public.items it
    join public.item_tags t on t.item_id = it.id
    join public.post_media pm on pm.id = t.post_media_id
    where v_query is not null and it.search @@ v_query
    group by pm.post_id
  ),
  visible as (
    select p.*, mt.item_ids,
           (p.author_id = v_uid or p.area_id in (select area_id from nearby)) as is_nearby
    from public.posts p
    left join matches mt on mt.post_id = p.id
    where p.status = 'published'
      and (v_query is null or mt.post_id is not null)
      and (p_before_published_at is null
           or (p.published_at, p.id) < (p_before_published_at,
               coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  )
  select
    v.id,
    v.caption,
    v.published_at,
    v.author_id,
    pr.handle,
    pr.display_name,
    case when v.is_nearby then a.name end,
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'path', m.storage_path,
                  'width', m.width,
                  'height', m.height,
                  'tags', coalesce(
                    (select jsonb_agg(
                              jsonb_build_object(
                                'id', t.id, 'x', t.x, 'y', t.y,
                                'item', jsonb_build_object(
                                  'id', it.id, 'title', it.title, 'brand', it.brand,
                                  'store_name', it.store_name, 'url', it.url,
                                  'url_host', it.url_host, 'price_cents', it.price_cents,
                                  'currency', it.currency, 'is_affiliate', it.is_affiliate))
                              order by t.y, t.x)
                     from public.item_tags t
                     join public.items it on it.id = t.item_id
                     where t.post_media_id = m.id),
                    '[]'::jsonb))
                order by m.position)
       from public.post_media m where m.post_id = v.id),
      '[]'::jsonb),
    coalesce(
      (select array_agg(pi.interest_id order by pi.interest_id)
       from public.post_interests pi where pi.post_id = v.id),
      '{}'::smallint[]),
    coalesce(v.item_ids, '{}'::uuid[])
  from visible v
  join public.profiles pr on pr.id = v.author_id
  join public.areas a on a.id = v.area_id
  where v.is_nearby or public.post_is_globally_searchable(v.id)
  order by v.published_at desc, v.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke execute on function public.discover_posts(text, int, timestamptz, uuid) from public, anon;
grant execute on function public.discover_posts(text, int, timestamptz, uuid) to authenticated;
