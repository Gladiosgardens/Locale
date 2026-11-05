-- Topics for everyone, and a personal For you feed.
--
-- 1. More topics people shop from photos: tech, audio, desk and gaming setups,
--    watches, grooming, fragrance, outdoor gear, grilling, motorcycles, DIY.
-- 2. Every topic belongs to a section (Style, Home, Tech & cars, Food & drink,
--    Active & outdoors, Everyday) so the picker is easy to scan.
-- 3. discover_posts(p_for_you => true) ranks posts in your topics and from
--    people you follow above other recent posts. Nobody is asked their gender:
--    the feed follows the topics each person picks.

------------------------------------------------------------------------------
-- Topics and sections
------------------------------------------------------------------------------

alter table public.interests add column section text not null default 'everyday'
  check (section in ('style', 'home', 'tech', 'food', 'active', 'everyday'));

insert into public.interests (slug, label, sort_order, section) values
  ('watches', 'Watches', 92, 'style'),
  ('grooming', 'Grooming', 125, 'style'),
  ('fragrance', 'Fragrance', 128, 'style'),
  ('tech', 'Tech & gadgets', 500, 'tech'),
  ('phones', 'Phones & accessories', 510, 'tech'),
  ('audio', 'Audio & headphones', 520, 'tech'),
  ('desk-setups', 'Desk & gaming setups', 530, 'tech'),
  ('gaming', 'Gaming', 540, 'tech'),
  ('smart-home', 'Smart home', 550, 'tech'),
  ('motorcycles', 'Motorcycles', 570, 'tech'),
  ('outdoor-gear', 'Outdoor & camping gear', 365, 'active'),
  ('grilling', 'Grilling & BBQ', 305, 'food'),
  ('diy-tools', 'DIY & tools', 270, 'home')
on conflict (slug) do update set active = true, section = excluded.section;

update public.interests set section = v.section, sort_order = coalesce(v.sort_order, interests.sort_order)
from (values
  ('fashion', 'style', null), ('menswear', 'style', null), ('streetwear', 'style', null),
  ('minimalist', 'style', null), ('luxury', 'style', null), ('thrifting', 'style', null),
  ('modest-fashion', 'style', null), ('sneakers', 'style', null), ('jewelry', 'style', null),
  ('bags-accessories', 'style', null), ('occasion-wear', 'style', null), ('beauty', 'style', null),
  ('skincare', 'style', null),
  ('interior-design', 'home', null), ('home-decor', 'home', null), ('furniture', 'home', null),
  ('architecture', 'home', null), ('art', 'home', null), ('gardening', 'home', 280),
  ('photography', 'tech', 560), ('cars', 'tech', 565),
  ('food', 'food', null), ('cooking', 'food', null), ('coffee', 'food', null),
  ('fitness', 'active', null), ('running', 'active', null), ('yoga', 'active', null),
  ('hiking', 'active', null), ('cycling', 'active', null), ('sports', 'active', null),
  ('travel-style', 'everyday', 600), ('dogs', 'everyday', 610), ('cats', 'everyday', 620),
  ('books', 'everyday', 630), ('music', 'everyday', 640), ('board-games', 'everyday', 650)
) as v(slug, section, sort_order)
where interests.slug = v.slug;

------------------------------------------------------------------------------
-- For you ranking
------------------------------------------------------------------------------

drop function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid);
create function public.discover_posts(
  p_query text default null,
  p_limit int default 20,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null,
  p_following boolean default false,
  p_author_id uuid default null,
  p_post_id uuid default null,
  p_for_you boolean default false
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
  matched_item_ids uuid[],
  rank_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_query tsquery;
  -- For you: a post in one of your topics counts as this much newer, and one
  -- from someone you follow as this much newer. Ranking by this "effective
  -- time" keeps paging simple: the cursor is (rank_at, id).
  v_topic_boost constant interval := interval '36 hours';
  v_follow_boost constant interval := interval '24 hours';
  v_my_topics smallint[];
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

  if p_for_you then
    select coalesce(array_agg(pi.interest_id), '{}') into v_my_topics
    from public.profile_interests pi where pi.profile_id = v_uid;
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
           coalesce(p.author_id = v_uid or p.area_id in (select area_id from nearby), false) as is_nearby,
           case when p_for_you then
             p.published_at
             + case when exists (select 1 from public.post_interests pi
                                 where pi.post_id = p.id and pi.interest_id = any (v_my_topics))
                    then v_topic_boost else interval '0' end
             + case when p.author_id <> v_uid and p.author_id in (
                      select f.followee_id from public.follows f where f.follower_id = v_uid)
                    then v_follow_boost else interval '0' end
           else p.published_at end as rank_at
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
      -- In For you the cursor is a rank_at; rank_at is never before published_at, so this only skips posts that can't come next.
      and (p_before_published_at is null
           or (not p_for_you and (p.published_at, p.id) < (p_before_published_at,
               coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
           or (p_for_you and p.published_at < p_before_published_at))
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
    coalesce(v.item_ids, '{}'::uuid[]),
    v.rank_at
  from visible v
  join public.profiles pr on pr.id = v.author_id
  left join public.areas a on a.id = v.area_id
  where (v.is_nearby or public.post_is_globally_searchable(v.id))
    and (not p_for_you or p_before_published_at is null
         or (v.rank_at, v.id) < (p_before_published_at,
             coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by v.rank_at desc, v.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean) from public, anon;
grant execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean) to authenticated;
