-- Automatic item detection and "Find similar", plus the shopping switch.
--
-- detect-items (Edge Function) finds items in a photo the poster is about to
-- share (Anthropic vision) and looks up where to buy each one (Google Lens via
-- SerpApi). The poster confirms which suggestions become tags; nothing is
-- tagged without them. similar-items finds similar products for an item that
-- has no link, for viewers. Both are limited per person per day.
--
-- posts.shopping_enabled = false means the post shows no tags or shop links
-- and is never sent for detection or "Find similar". People can make that
-- their default in Settings.

alter table public.posts add column shopping_enabled boolean not null default true;
alter table public.profile_private add column shopping_default boolean not null default true;

create function public.set_shopping_default(p_enabled boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profile_private set shopping_default = coalesce(p_enabled, shopping_default)
  where profile_id = auth.uid()
$$;

create table public.detection_log (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('detect', 'similar')),
  created_at timestamptz not null default now()
);
create index detection_log_idx on public.detection_log (profile_id, kind, created_at desc);

-- "Find similar" results, reused for a week so repeat taps cost nothing.
create table public.item_suggestions (
  item_id uuid primary key references public.items (id) on delete cascade,
  results jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.detection_log enable row level security;
alter table public.item_suggestions enable row level security;
revoke all on public.detection_log, public.item_suggestions from anon, authenticated;

-- Counts and logs one use; refuses past the daily limit. Service role only.
create function public.use_detection(p_profile_id uuid, p_kind text, p_daily_limit int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.detection_log
      where profile_id = p_profile_id and kind = p_kind and created_at > now() - interval '24 hours') >= p_daily_limit then
    return false;
  end if;
  insert into public.detection_log (profile_id, kind) values (p_profile_id, p_kind);
  return true;
end;
$$;

-- For "Find similar": the photo an item is tagged on, if the caller can see
-- the post and its author shows shopping. Called with the caller's own token.
create function public.similar_item_source(p_item_id uuid, p_post_id uuid)
returns table (storage_path text, title text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.storage_path, i.title
  from public.item_tags t
  join public.post_media m on m.id = t.post_media_id
  join public.posts p on p.id = m.post_id
  join public.items i on i.id = t.item_id
  where t.item_id = p_item_id and m.post_id = p_post_id
    and m.kind = 'image'
    and p.shopping_enabled
    and auth.uid() is not null
    and public.can_view_post(p_post_id)
  order by m.position
  limit 1
$$;

revoke execute on function public.set_shopping_default(boolean) from public, anon;
revoke execute on function public.use_detection(uuid, text, int) from public, anon, authenticated;
revoke execute on function public.similar_item_source(uuid, uuid) from public, anon;
grant execute on function public.set_shopping_default(boolean) to authenticated;
grant execute on function public.use_detection(uuid, text, int) to service_role;
grant execute on function public.similar_item_source(uuid, uuid) to authenticated;
