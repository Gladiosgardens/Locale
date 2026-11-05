-- RLS and RPC tests for onboarding. Run with `npm run db:test` (supabase test db).
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- These tests cover the local features, which use interests retired in global mode.
update public.interests set active = true;

-- Fixtures (as postgres): two users; the trigger creates their profiles.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');

select is(
  (select count(*)::int from public.profiles
   where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')),
  2, 'signup trigger creates a profile per user');
select is(
  (select count(*)::int from public.profile_private
   where profile_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')),
  2, 'signup trigger creates a private profile row per user');

select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.areas'::regclass, 'public.interests'::regclass, 'public.profiles'::regclass,
                 'public.profile_private'::regclass, 'public.profile_interests'::regclass,
                 'public.area_changes'::regclass)),
  'RLS is enabled on every table');

------------------------------------------------------------------------------
-- Anonymous
------------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select ok((select count(*) from public.interests) >= 20, 'anon can read interests');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok('select * from public.areas', '42501', null, 'anon cannot read areas');
select throws_ok($$select public.set_my_area('9q9k5', 'Downtown')$$, '42501', null,
  'anon cannot call set_my_area');

------------------------------------------------------------------------------
-- User A
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.profiles), 1,
  'A sees only their own profile while nobody is onboarded');
select is((select count(*)::int from public.profile_private), 1,
  'A sees only their own private row');

select throws_ok($$insert into public.areas (geohash5, name, center_lat, center_lng)
  values ('9q9k5', 'Fake', 0, 0)$$, '42501', null, 'A cannot insert areas directly');
select throws_ok($$update public.profiles set onboarded_at = now()
  where id = '00000000-0000-0000-0000-00000000000a'$$, '42501', null,
  'A cannot set onboarded_at directly');
select throws_ok($$update public.profile_private set area_id = null
  where profile_id = '00000000-0000-0000-0000-00000000000a'$$, '42501', null,
  'A cannot write the private row directly');
select throws_ok($$insert into public.profile_interests (profile_id, interest_id)
  values ('00000000-0000-0000-0000-00000000000a', 1)$$, '42501', null,
  'A cannot insert interests directly');

select throws_ok($$select public.complete_onboarding('alice', 'Alice', true)$$, '22023',
  'interest_count', 'onboarding requires interests first');

select throws_ok($$select public.set_my_area('9q9k!', 'Downtown')$$, '22023',
  'invalid_geohash', 'set_my_area rejects a malformed geohash');
select throws_ok($$select public.set_my_area('9q9k5', 'x')$$, '22023',
  'invalid_area_name', 'set_my_area rejects a too-short name');
select lives_ok($$select public.set_my_area(' 9Q9K5 ', '  Downtown   San Jose ')$$,
  'set_my_area accepts a valid cell (normalised)');

select is((select a.name from public.profile_private p join public.areas a on a.id = p.area_id),
  'Downtown San Jose', 'A is placed in the new area, name whitespace collapsed');
select ok((select a.center_lat = (public.geohash_center('9q9k5')).lat
             and a.center_lng = (public.geohash_center('9q9k5')).lng
           from public.areas a where geohash5 = '9q9k5'),
  'area centre is derived server-side from the cell');

select throws_ok($$select public.set_my_interests(array[1, 2]::smallint[])$$, '22023',
  'interest_count', 'fewer than 3 interests is rejected');
select throws_ok($$select public.set_my_interests(array[1, 2, 32000]::smallint[])$$, '22023',
  'unknown_interest', 'unknown interest ids are rejected');
select lives_ok($$select public.set_my_interests(array[1, 2, 3, 3]::smallint[])$$,
  'three distinct interests are accepted (duplicates ignored)');
select is((select count(*)::int from public.profile_interests), 3, 'A has 3 interests');

select throws_ok($$select public.complete_onboarding('alice', 'Alice', false)$$, '22023',
  'adult_required', 'onboarding requires the 18+ confirmation');
select throws_ok($$select public.complete_onboarding('a!', 'Alice', true)$$, '23514',
  'invalid_profile', 'invalid handle is rejected');
select throws_ok($$select public.complete_onboarding('Admin', 'Alice', true)$$, '23514',
  'invalid_profile', 'reserved handles are rejected');
select lives_ok($$select public.complete_onboarding(' Alice ', 'Alice', true)$$,
  'A completes onboarding');
select is((select handle from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'alice', 'handle is stored lowercase and trimmed');
select throws_ok($$update public.profiles set handle = 'support'
  where id = '00000000-0000-0000-0000-00000000000a'$$, '23514', null,
  'reserved handles are rejected on direct update too');
select throws_ok('select * from public.area_changes', '42501', null,
  'clients cannot read the area change log');

------------------------------------------------------------------------------
-- User B
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.profiles where handle = 'alice'), 1,
  'B can see onboarded A');
select is((select count(*)::int from public.profile_private
           where profile_id = '00000000-0000-0000-0000-00000000000a'), 0,
  'B cannot see A''s area or 18+ flag');
select is((select count(*)::int from public.profile_interests
           where profile_id = '00000000-0000-0000-0000-00000000000a'), 0,
  'B cannot see A''s interests');

with u as (
  update public.profiles set display_name = 'Hacked'
  where id = '00000000-0000-0000-0000-00000000000a' returning 1
)
select is((select count(*)::int from u), 0, 'B cannot update A''s profile');

select public.set_my_area('9q9k5', 'Renamed By B');
select is((select name from public.areas where geohash5 = '9q9k5'), 'Downtown San Jose',
  'joining an existing cell does not rename it');

select public.set_my_interests(array[4, 5, 6]::smallint[]);
select throws_ok($$select public.complete_onboarding('alice', 'Bob', true)$$, '23505',
  'handle_taken', 'a taken handle is rejected');

-- B has used 1 area change; 4 more are allowed, the 6th in 24h is refused.
select public.set_my_area(c, 'Somewhere') from unnest(array['9q9k6', '9q9k7', '9q9kd', '9q9ke']) as c;
select throws_ok($$select public.set_my_area('9q9ks', 'One Too Many')$$, 'P0001',
  'area_rate_limited', 'a 6th area change within 24h is refused');
select is((select count(*)::int from public.areas where geohash5 = '9q9ks'), 0,
  'a refused change creates no area');

select * from finish();
rollback;
