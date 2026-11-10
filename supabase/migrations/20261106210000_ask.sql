-- Step 21: "Where's this from?" A post can ask where something in it is from.
-- Anyone who can see it suggests an answer (a link, store or price); when the
-- poster accepts one it becomes a tagged item created by the answerer, so the
-- answerer earns the commission when people buy through it.

alter table public.posts add column asking boolean not null default false;
create index posts_asking on public.posts (published_at desc) where asking and status = 'published';

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  answerer_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (title = btrim(title) and char_length(title) between 1 and 80),
  store_name text check (store_name = btrim(store_name) and char_length(store_name) between 1 and 60),
  url text,
  url_host text,
  price_cents int check (price_cents between 0 and 100000000),
  currency text check (currency ~ '^[A-Z]{3}$'),
  note text check (char_length(note) <= 300),
  x real check (x between 0 and 1),
  y real check (y between 0 and 1),
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  item_id uuid references public.items (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint answers_price_currency check ((price_cents is null) = (currency is null)),
  constraint answers_url_host check (url_host is not distinct from public.item_url_host(url)),
  constraint answers_something check (url is not null or store_name is not null)
);
create index answers_post on public.answers (post_id, created_at);
create index answers_answerer on public.answers (answerer_id, created_at desc);
alter table public.answers enable row level security;
-- No client policies: everything goes through the functions below.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('message', 'message_request', 'group_join_request', 'group_join_approved', 'new_follower',
                  'comment', 'reply', 'mention', 'comment_mention', 'tag',
                  'sale', 'first_sale', 'weekly_earnings', 'payout_sent', 'answer', 'answer_accepted'));

-- The author turns asking off once they've found it (or on again).
create function public.set_post_asking(p_post_id uuid, p_asking boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts set asking = p_asking
  where id = p_post_id and author_id = auth.uid() and status = 'published' and kind = 'post'
    and (not p_asking or shopping_enabled);
  if not found then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.submit_answer(
  p_post_id uuid,
  p_title text,
  p_url text default null,
  p_store_name text default null,
  p_price_cents int default null,
  p_currency text default null,
  p_note text default null,
  p_x real default null,
  p_y real default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select p.author_id into v_author from public.posts p
  where p.id = p_post_id and p.asking and p.status = 'published' and public.can_view_post(p.id);
  if v_author is null then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  if v_author = v_uid then
    raise exception 'own_post' using errcode = '22023';
  end if;
  if (select count(*) from public.answers where answerer_id = v_uid and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'answer_rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from public.answers where post_id = p_post_id and answerer_id = v_uid) >= 3 then
    raise exception 'answer_limit' using errcode = 'P0001';
  end if;
  insert into public.answers (post_id, answerer_id, title, store_name, url, url_host, price_cents, currency, note, x, y)
  values (p_post_id, v_uid, btrim(p_title), nullif(btrim(coalesce(p_store_name, '')), ''), v_url,
          case when v_url is null then null else public.item_url_host(v_url) end,
          p_price_cents, case when p_price_cents is null then null else upper(p_currency) end,
          nullif(btrim(coalesce(p_note, '')), ''), p_x, p_y)
  returning id into v_id;

  insert into public.notifications (recipient_id, kind, actor_id, post_id)
  select v_author, 'answer', v_uid, p_post_id
  where coalesce((select notify_comments from public.profile_private where profile_id = v_author), false)
    and public.may_notify_about_post(v_author, v_uid, p_post_id)
  on conflict (recipient_id, kind, post_id) where sent_at is null and post_id is not null
  do update set actor_id = excluded.actor_id;
  return v_id;
exception
  when check_violation then
    raise exception 'invalid_answer' using errcode = '22023';
end;
$$;

-- Answers on a post, oldest first. Everyone who can see the post sees them.
create function public.list_answers(p_post_id uuid)
returns table (
  id uuid,
  answerer_id uuid,
  answerer_handle text,
  answerer_display_name text,
  title text,
  store_name text,
  url text,
  url_host text,
  price_cents int,
  currency text,
  note text,
  status text,
  created_at timestamptz,
  is_mine boolean,
  can_accept boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.answerer_id, pr.handle, pr.display_name, a.title, a.store_name, a.url, a.url_host,
         a.price_cents, a.currency, a.note, a.status, a.created_at,
         a.answerer_id = auth.uid(),
         a.status = 'pending' and p.author_id = auth.uid()
  from public.answers a
  join public.posts p on p.id = a.post_id
  join public.profiles pr on pr.id = a.answerer_id
  where a.post_id = p_post_id and public.can_view_post(p_post_id)
    and a.answerer_id not in (select public.my_block_peers())
  order by (a.status = 'accepted') desc, a.created_at
  limit 200
$$;

-- The answerer withdraws it, or the poster dismisses it (pending answers only).
create function public.delete_answer(p_answer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.answers a using public.posts p
  where a.id = p_answer_id and p.id = a.post_id and a.status = 'pending'
    and (a.answerer_id = auth.uid() or p.author_id = auth.uid());
  if not found then
    raise exception 'answer_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- The poster accepts: the answer becomes an item (created by the answerer, so
-- shop taps credit them) tagged on the post's first photo.
create function public.accept_answer(p_answer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a public.answers%rowtype;
  v_media uuid;
  v_item uuid;
begin
  select an.* into a from public.answers an join public.posts p on p.id = an.post_id
  where an.id = p_answer_id and an.status = 'pending' and p.author_id = v_uid and p.status = 'published'
  for update of an;
  if a.id is null then
    raise exception 'answer_not_found' using errcode = 'P0002';
  end if;
  select pm.id into v_media from public.post_media pm where pm.post_id = a.post_id order by pm.position limit 1;
  if (select count(*) from public.item_tags t where t.post_media_id = v_media) >= 20 then
    raise exception 'too_many_tags' using errcode = 'P0001';
  end if;
  insert into public.items (created_by, title, store_name, url, url_host, price_cents, currency)
  values (a.answerer_id, a.title, a.store_name, a.url, a.url_host, a.price_cents, a.currency)
  returning id into v_item;
  insert into public.item_tags (post_media_id, item_id, x, y)
  values (v_media, v_item, coalesce(a.x, 0.5), coalesce(a.y, 0.5));
  update public.answers set status = 'accepted', item_id = v_item where id = a.id;

  insert into public.notifications (recipient_id, kind, actor_id, post_id)
  select a.answerer_id, 'answer_accepted', v_uid, a.post_id
  where public.may_notify_about_post(a.answerer_id, v_uid, a.post_id)
  on conflict (recipient_id, kind, post_id) where sent_at is null and post_id is not null
  do update set actor_id = excluded.actor_id;
  return v_item;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.set_post_asking(uuid, boolean)',
    'public.submit_answer(uuid, text, text, text, int, text, text, real, real)',
    'public.list_answers(uuid)', 'public.delete_answer(uuid)', 'public.accept_answer(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- Shop taps now credit whoever created the item: the poster for their own
-- tags, the answerer for an accepted answer.
create or replace function public.start_shop_click(p_post_id uuid, p_item_id uuid)
returns table (click_id uuid, url text, own_affiliate boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_url text;
  v_affiliate boolean;
  v_creator uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.posts p where p.id = p_post_id) or not public.can_view_post(p_post_id) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  select it.url, it.is_affiliate, it.created_by into v_url, v_affiliate, v_creator
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
    return query select null::uuid, v_url, v_affiliate;
    return;
  end if;
  insert into public.affiliate_clicks (post_id, item_id, poster_id, clicker_id, credit_poster)
  values (p_post_id, p_item_id, v_creator, v_uid, v_uid <> v_creator and not v_affiliate)
  returning id into v_id;
  return query select v_id, v_url, v_affiliate;
end;
$$;

-- Feeds: an "asking" flag and answer count on every post, and a filter for
-- posts still asking (Explore's "Help find" row).
drop function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean, boolean, text, uuid, uuid);
create function public.discover_posts(
  p_query text default null,
  p_limit int default 20,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null,
  p_following boolean default false,
  p_author_id uuid default null,
  p_post_id uuid default null,
  p_for_you boolean default false,
  p_saved boolean default false,
  p_hashtag text default null,
  p_tagged_id uuid default null,
  p_collection_id uuid default null,
  p_asking boolean default false
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
  rank_at timestamptz,
  like_count int,
  comment_count int,
  i_liked boolean,
  i_saved boolean,
  asking boolean,
  answer_count int
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
      and p.kind = 'post'
      and p.group_id is null
      and p.author_id not in (select public.my_block_peers())
      and (not p_following or p.author_id in (
            select f.followee_id from public.follows f where f.follower_id = v_uid))
      and (p_author_id is null or p.author_id = p_author_id)
      and (p_post_id is null or p.id = p_post_id)
      and (not p_saved or p.id in (select sp.post_id from public.saved_posts sp where sp.profile_id = v_uid))
      and (p_hashtag is null or p.id in (
            select h.post_id from public.post_hashtags h where h.tag = lower(ltrim(btrim(p_hashtag), '#'))))
      and (p_tagged_id is null or p.id in (
            select pm.post_id from public.people_tags pt join public.post_media pm on pm.id = pt.post_media_id
            where pt.profile_id = p_tagged_id))
      and (p_collection_id is null or p.id in (
            select cp.post_id from public.collection_posts cp join public.collections c on c.id = cp.collection_id
            where cp.collection_id = p_collection_id and c.owner_id = v_uid))
      and (not p_asking or p.asking)
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
    v.rank_at,
    (select count(*)::int from public.post_likes l where l.post_id = v.id),
    (select count(*)::int from public.comments c
     where c.post_id = v.id and c.removed_at is null and c.hidden_at is null
       and c.author_id not in (select public.my_block_peers())),
    exists (select 1 from public.post_likes l where l.post_id = v.id and l.profile_id = v_uid),
    exists (select 1 from public.saved_posts sp where sp.post_id = v.id and sp.profile_id = v_uid),
    v.asking,
    (select count(*)::int from public.answers an where an.post_id = v.id)
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
revoke execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean, boolean, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean, boolean, text, uuid, uuid, boolean) to authenticated;
