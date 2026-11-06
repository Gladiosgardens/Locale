-- Short videos, hosted by Mux.
--
-- The phone uploads straight to Mux using a one-time upload URL from the
-- create-video-upload Edge Function, which records who it belongs to here.
-- publish-post checks the finished video with Mux (owner, length, ready)
-- before create_post_record attaches it to a post. A post is up to 10 photos
-- or exactly one video of up to 60 seconds.
--
-- Note: playback is public by Mux playback ID (IDs are only handed out by
-- discover_posts to people allowed to see the post). Before launch, switch to
-- signed playback and delete Mux assets when posts are removed (see README).

create table public.video_uploads (
  upload_id text primary key check (upload_id ~ '^[A-Za-z0-9]{8,80}$'),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  asset_id text unique,
  post_id uuid references public.posts (id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index video_uploads_profile_idx on public.video_uploads (profile_id, created_at desc);
alter table public.video_uploads enable row level security;
revoke all on public.video_uploads from anon, authenticated;

alter table public.post_media
  add column kind text not null default 'image' check (kind in ('image', 'video')),
  add column mux_asset_id text unique,
  add column mux_playback_id text,
  add column duration_s real check (duration_s between 0 and 61),
  alter column storage_path drop not null,
  add constraint post_media_kind_fields check (
    (kind = 'image' and storage_path is not null and mux_playback_id is null)
    or (kind = 'video' and storage_path is null and mux_playback_id is not null and mux_asset_id is not null));

-- At most 20 video uploads a day per person (checked by create-video-upload).
create function public.video_upload_count_today(p_profile_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.video_uploads
  where profile_id = p_profile_id and created_at > now() - interval '24 hours'
$$;
revoke execute on function public.video_upload_count_today(uuid) from public, anon, authenticated;
grant execute on function public.video_upload_count_today(uuid) to service_role;

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
  v_is_video boolean;
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

  -- A post is up to 10 photos, or exactly one video.
  v_is_video := exists (select 1 from jsonb_array_elements(p_media) x where x.value ->> 'kind' = 'video');
  if v_is_video and v_count <> 1 then
    raise exception 'media_count' using errcode = '22023';
  end if;

  for m in select value from jsonb_array_elements(p_media) loop
    if v_is_video then
      -- The video must be one this author uploaded and hasn't used yet; the
      -- Edge Function has already checked it with Mux.
      if coalesce(m ->> 'asset_id', '') !~ '^[A-Za-z0-9]{8,80}$'
         or coalesce(m ->> 'playback_id', '') !~ '^[A-Za-z0-9]{8,80}$'
         or coalesce((m ->> 'duration')::real, 999) > 61 then
        raise exception 'invalid_video' using errcode = '22023';
      end if;
      update public.video_uploads set used_at = now(), post_id = p_post_id
      where profile_id = p_author_id and asset_id = m ->> 'asset_id' and used_at is null;
      if not found then
        raise exception 'invalid_video' using errcode = '22023';
      end if;
      insert into public.post_media (post_id, kind, storage_path, mux_asset_id, mux_playback_id, duration_s,
                                     width, height, position)
      values (p_post_id, 'video', null, m ->> 'asset_id', m ->> 'playback_id', (m ->> 'duration')::real,
              (m ->> 'width')::int, (m ->> 'height')::int, i)
      returning id into v_media_id;
    else
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
    end if;
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

create or replace function public.post_media_json(p_post_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select jsonb_agg(
              jsonb_build_object(
                'kind', m.kind,
                'path', m.storage_path,
                'playback_id', m.mux_playback_id,
                'duration', m.duration_s,
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
     from public.post_media m where m.post_id = p_post_id),
    '[]'::jsonb)
$$;
