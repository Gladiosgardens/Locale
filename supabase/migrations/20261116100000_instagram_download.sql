-- Import from an Instagram download. The phone reads the download file
-- (the "Download your information" export) and publishes the posts the person
-- picks through publish-post, which calls create_imported_post. New Meta apps
-- can't use Instagram Login any more, so this replaces the API import in the app.
--
-- Imported captions keep their hashtags, but @names in them are Instagram
-- usernames, which may belong to someone else on Locale: no mentions are linked
-- or notified (locale.import).

create or replace function public.on_post_caption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid[];
begin
  delete from public.post_hashtags where post_id = new.id;
  if new.kind = 'post' and coalesce(current_setting('locale.story', true), '') <> 'on' then
    insert into public.post_hashtags (post_id, tag)
    select new.id, t from unnest(public.extract_hashtags(new.caption)) t;
  end if;

  select coalesce(array_agg(pr.id), '{}') into v_new
  from public.profiles pr
  where coalesce(current_setting('locale.import', true), '') <> 'on'
    and pr.handle = any (public.extract_mentions(new.caption))
    and pr.onboarded_at is not null
    and pr.id <> new.author_id
    and not exists (select 1 from public.blocks b
                    where (b.blocker_id = pr.id and b.blocked_id = new.author_id)
                       or (b.blocker_id = new.author_id and b.blocked_id = pr.id));

  delete from public.post_mentions where post_id = new.id and profile_id <> all (v_new);
  with added as (
    insert into public.post_mentions (post_id, profile_id)
    select new.id, r from unnest(v_new) r
    on conflict do nothing
    returning profile_id
  )
  select coalesce(array_agg(profile_id), '{}') into v_new from added;

  if new.status = 'published' and new.kind = 'post' and coalesce(current_setting('locale.story', true), '') <> 'on' then
    perform public.notify_mentions(v_new, 'mention', new.author_id, new.id);
  end if;
  return new;
end;
$$;

-- Service role: publish one imported post with its Instagram date, once per
-- Instagram post (p_key identifies it within the person's download).
create function public.create_imported_post(
  p_post_id uuid,
  p_author_id uuid,
  p_caption text,
  p_media jsonb,
  p_key text,
  p_taken_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^[A-Za-z0-9:_.-]{1,200}$' then
    raise exception 'bad_request';
  end if;
  if exists (select 1 from public.instagram_imports
             where profile_id = p_author_id and ig_media_id = p_key and post_id is not null) then
    raise exception 'already_imported';
  end if;
  perform set_config('locale.import', 'on', true);
  perform public.create_post_record(p_post_id, p_author_id, p_caption, '{}'::smallint[], p_media, '[]'::jsonb, true, null);
  perform set_config('locale.import', 'off', true);
  perform public.set_imported_post_date(p_post_id, p_author_id, p_taken_at);
  insert into public.instagram_imports (profile_id, ig_media_id, post_id)
  values (p_author_id, p_key, p_post_id)
  on conflict (profile_id, ig_media_id) do update set post_id = excluded.post_id, imported_at = now();
end;
$$;
revoke execute on function public.create_imported_post(uuid, uuid, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_imported_post(uuid, uuid, text, jsonb, text, timestamptz) to service_role;

-- Which of these posts from my download are already on Locale.
create function public.my_imported_keys(p_keys text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select ig_media_id from public.instagram_imports
  where profile_id = auth.uid() and post_id is not null and ig_media_id = any (p_keys[1:500])
$$;
revoke execute on function public.my_imported_keys(text[]) from public, anon;
grant execute on function public.my_imported_keys(text[]) to authenticated;
