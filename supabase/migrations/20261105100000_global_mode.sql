-- Global mode: Locale becomes a public, fashion-and-design photo app first.
--
-- The neighborhood features stay in the database but are optional:
-- - onboarding no longer needs an area;
-- - posts by people without an area have no area and are global;
-- - interests switch to fashion and design (local/kid interests are retired,
--   not deleted, so old data stays valid);
-- - discover_posts() handles area-less posts and can fetch a single post.

------------------------------------------------------------------------------
-- Interests
------------------------------------------------------------------------------

alter table public.interests add column active boolean not null default true;

update public.interests set active = false
where slug in ('dogs', 'cats', 'toddlers', 'school-age-kids', 'teens', 'running', 'hiking',
               'cycling', 'yoga', 'gardening', 'cooking', 'coffee', 'books', 'board-games',
               'remote-work', 'new-in-town');

update public.interests set label = 'Interior design', sort_order = 200 where slug = 'interior-design';
update public.interests set label = 'Womenswear', sort_order = 10 where slug = 'fashion';
update public.interests set label = 'Beauty', sort_order = 120 where slug = 'beauty';
update public.interests set label = 'Vintage & thrift', sort_order = 60 where slug = 'thrifting';
update public.interests set label = 'Photography', sort_order = 260 where slug = 'photography';

insert into public.interests (slug, label, sort_order) values
  ('menswear', 'Menswear', 20),
  ('streetwear', 'Streetwear', 30),
  ('minimalist', 'Minimalist', 40),
  ('luxury', 'Luxury', 50),
  ('modest-fashion', 'Modest fashion', 70),
  ('sneakers', 'Sneakers', 80),
  ('jewelry', 'Jewelry', 90),
  ('bags-accessories', 'Bags & accessories', 100),
  ('occasion-wear', 'Occasion & wedding', 110),
  ('skincare', 'Skincare', 130),
  ('home-decor', 'Home decor', 210),
  ('furniture', 'Furniture', 220),
  ('architecture', 'Architecture', 230),
  ('art', 'Art & objects', 240),
  ('travel-style', 'Travel style', 250);

------------------------------------------------------------------------------
-- Area becomes optional
------------------------------------------------------------------------------

alter table public.posts alter column area_id drop not null;

create or replace function public.set_my_interests(p_interest_ids smallint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids smallint[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids
  from unnest(coalesce(p_interest_ids, '{}')) as x;
  if cardinality(v_ids) not between 3 and 15 then
    raise exception 'interest_count' using errcode = '22023';
  end if;
  if (select count(*) from public.interests where id = any (v_ids) and active) <> cardinality(v_ids) then
    raise exception 'unknown_interest' using errcode = '22023';
  end if;

  delete from public.profile_interests
  where profile_id = v_uid and interest_id <> all (v_ids);

  insert into public.profile_interests (profile_id, interest_id)
  select v_uid, x from unnest(v_ids) as x
  on conflict do nothing;
end;
$$;


-- Final onboarding step. Requires >= 3 interests and an 18+ confirmation. An area is
-- optional: it only matters for the (currently hidden) local features.
create or replace function public.complete_onboarding(
  p_handle text,
  p_display_name text,
  p_confirm_adult boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_confirm_adult is not true then
    raise exception 'adult_required' using errcode = '22023';
  end if;
  if (select count(*) from public.profile_interests where profile_id = v_uid) < 3 then
    raise exception 'interest_count' using errcode = '22023';
  end if;

  begin
    update public.profiles
    set handle = lower(btrim(p_handle)),
        display_name = btrim(p_display_name),
        onboarded_at = coalesce(onboarded_at, now())
    where id = v_uid
    returning * into v_profile;
  exception
    when unique_violation then
      raise exception 'handle_taken' using errcode = '23505';
    when check_violation then
      raise exception 'invalid_profile' using errcode = '23514';
  end;

  update public.profile_private
  set adult_confirmed_at = coalesce(adult_confirmed_at, now())
  where profile_id = v_uid;

  return v_profile;
end;
$$;


------------------------------------------------------------------------------
-- Posting without an area
------------------------------------------------------------------------------

create or replace function public.create_post_record(
  p_post_id uuid,
  p_author_id uuid,
  p_caption text,
  p_interest_ids smallint[],
  p_media jsonb,
  p_tags jsonb default '[]'::jsonb,
  p_searchable boolean default true,
  p_group_id uuid default null
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
  if not exists (select 1 from public.profiles where id = p_author_id and onboarded_at is not null) then
    raise exception 'not_onboarded' using errcode = '22023';
  end if;
  -- May be null: posts without an area are global (not tied to a neighborhood).
  select pp.area_id into v_area from public.profile_private pp where pp.profile_id = p_author_id;

  -- Group posts: author must be an active member; the post takes the group's
  -- area and is never globally searchable.
  if p_group_id is not null then
    if not exists (
      select 1 from public.group_members gm
      where gm.group_id = p_group_id and gm.profile_id = p_author_id and gm.status = 'active'
    ) then
      raise exception 'not_a_member' using errcode = '42501';
    end if;
    select g.area_id into v_area from public.groups g where g.id = p_group_id;
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
  if (select count(*) from public.interests where id = any (v_ids) and active) <> cardinality(v_ids) then
    raise exception 'unknown_interest' using errcode = '22023';
  end if;

  insert into public.posts (id, author_id, area_id, caption, searchable, group_id)
  values (p_post_id, p_author_id, v_area, v_caption,
          p_group_id is null and coalesce(p_searchable, true), p_group_id);

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

------------------------------------------------------------------------------
-- Discovery: area-less posts and single-post lookup
------------------------------------------------------------------------------

drop function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid);
create function public.discover_posts(
  p_query text default null,
  p_limit int default 20,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null,
  p_following boolean default false,
  p_author_id uuid default null,
  p_post_id uuid default null
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
           coalesce(p.author_id = v_uid or p.area_id in (select area_id from nearby), false) as is_nearby
    from public.posts p
    left join matches mt on mt.post_id = p.id
    where p.status = 'published'
      and p.group_id is null
      and p.author_id not in (select public.my_block_peers())
      and (not p_following or p.author_id in (
            select f.followee_id from public.follows f where f.follower_id = v_uid))
      and (p_author_id is null or p.author_id = p_author_id)
      and (p_post_id is null or p.id = p_post_id)
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
    public.post_media_json(v.id),
    coalesce(
      (select array_agg(pi.interest_id order by pi.interest_id)
       from public.post_interests pi where pi.post_id = v.id),
      '{}'::smallint[]),
    coalesce(v.item_ids, '{}'::uuid[])
  from visible v
  join public.profiles pr on pr.id = v.author_id
  left join public.areas a on a.id = v.area_id
  where v.is_nearby or public.post_is_globally_searchable(v.id)
  order by v.published_at desc, v.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid) from public, anon;
grant execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid) to authenticated;
