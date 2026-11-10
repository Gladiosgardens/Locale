-- Step 24: import posts from Instagram (professional accounts, through the
-- Instagram API with Instagram Login). The access token stays server-side;
-- imported photos are cleaned and published like any post, keeping their
-- original date so they fill the profile without flooding followers' feeds.

create table public.instagram_connections (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  ig_user_id text not null,
  username text,
  access_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.instagram_oauth_states (
  state text primary key check (char_length(state) >= 32),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.instagram_imports (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  ig_media_id text not null,
  post_id uuid references public.posts (id) on delete set null,
  imported_at timestamptz not null default now(),
  primary key (profile_id, ig_media_id)
);

alter table public.instagram_connections enable row level security;
alter table public.instagram_oauth_states enable row level security;
alter table public.instagram_imports enable row level security;
-- Tokens never reach clients: no policies, and no table privileges.
revoke all on public.instagram_connections, public.instagram_oauth_states, public.instagram_imports from anon, authenticated;

-- What the app may know: connected or not, and the username.
create function public.my_instagram()
returns table (connected boolean, username text, expires_at timestamptz, imported int)
language sql
stable
security definer
set search_path = ''
as $$
  select c.profile_id is not null, c.username, c.expires_at,
         (select count(*)::int from public.instagram_imports i where i.profile_id = auth.uid() and i.post_id is not null)
  from (select auth.uid() as uid) me
  left join public.instagram_connections c on c.profile_id = me.uid
  where me.uid is not null
$$;

create function public.disconnect_instagram()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.instagram_connections where profile_id = auth.uid()
$$;

revoke execute on function public.my_instagram() from public, anon;
revoke execute on function public.disconnect_instagram() from public, anon;
grant execute on function public.my_instagram() to authenticated;
grant execute on function public.disconnect_instagram() to authenticated;

-- Service role (instagram-connect / instagram-callback):

-- Imported posts keep the date they were posted on Instagram (never in the future).
create function public.set_imported_post_date(p_post_id uuid, p_profile_id uuid, p_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.posts set published_at = least(p_at, now())
  where id = p_post_id and author_id = p_profile_id and kind = 'post'
$$;

-- One state per sign-in attempt, used once, valid for 15 minutes.
create function public.take_instagram_state(p_state text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  delete from public.instagram_oauth_states
  where state = p_state and created_at > now() - interval '15 minutes'
  returning profile_id
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.set_imported_post_date(uuid, uuid, timestamptz)', 'public.take_instagram_state(text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
grant all on public.instagram_connections, public.instagram_oauth_states, public.instagram_imports to service_role;
