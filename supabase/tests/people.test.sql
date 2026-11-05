-- Finding friends: people search, suggestions, contacts matching, follow notifications, topics.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- A, B, C, D, E onboarded; N never finished onboarding.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000007' || x)::uuid, 'User.' || x || '@Example.com'
from unnest(array['0a', '0b', '0c', '0d', '0e', '0f']) as x;
update public.profile_private set adult_confirmed_at = now()
where profile_id::text like '00000000-0000-0000-0000-0000000007%';
update public.profiles p set handle = v.h, display_name = v.n, onboarded_at = now() - v.age
from (values ('00000000-0000-0000-0000-00000000070a'::uuid, 'amira', 'Amira Hassan', interval '5 days'),
             ('00000000-0000-0000-0000-00000000070b'::uuid, 'ben_k', 'Ben Kim', interval '4 days'),
             ('00000000-0000-0000-0000-00000000070c'::uuid, 'cleo', 'Cleo Amir', interval '3 days'),
             ('00000000-0000-0000-0000-00000000070d'::uuid, 'dev100', 'Devon Park', interval '2 days'),
             ('00000000-0000-0000-0000-00000000070e'::uuid, 'eli_50', 'Eli 50% Off', interval '1 day')) as v(id, h, n, age)
where p.id = v.id;

------------------------------------------------------------------------------
-- Topics
------------------------------------------------------------------------------

select ok((select bool_and(active) from public.interests where slug in ('food', 'travel-style', 'dogs', 'coffee', 'fitness')),
  'everyday topics are active');
select ok((select bool_and(not active) from public.interests where slug in ('toddlers', 'school-age-kids', 'teens')),
  'kid topics stay retired');
select is((select label from public.interests where slug = 'travel-style'), 'Travel', 'travel is relabelled');

------------------------------------------------------------------------------
-- Email hashes
------------------------------------------------------------------------------

select is((select count(*)::int from public.email_hashes
           where profile_id::text like '00000000-0000-0000-0000-0000000007%'), 6,
  'every account gets an email hash at sign-up');
select is((select hash from public.email_hashes where profile_id = '00000000-0000-0000-0000-00000000070a'),
  encode(sha256(convert_to('user.0a@example.com', 'UTF8')), 'hex'), 'the hash is of the lowercased email');
update auth.users set email = 'new.address@example.com' where id = '00000000-0000-0000-0000-00000000070b';
select is((select hash from public.email_hashes where profile_id = '00000000-0000-0000-0000-00000000070b'),
  public.email_hash('new.address@example.com'), 'changing the email updates the hash');

------------------------------------------------------------------------------
-- As A
------------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000070a","role":"authenticated"}', true);
set local role authenticated;

select throws_ok('select * from public.email_hashes', '42501', null, 'email hashes are never readable');
select throws_ok('select * from public.contact_match_log', '42501', null, 'nor is the contacts log');

-- Search
select throws_ok($$select * from public.search_people('a')$$, '22023', 'query_too_short', 'one letter is too short');
select is((select array_agg(handle order by handle) from public.search_people('amir')), array['cleo'],
  'search matches the start of any word in the name, and never returns yourself');
select is((select array_agg(handle) from public.search_people('@BEN')), array['ben_k'], '@handle search, any case');
select is((select count(*)::int from public.search_people('dev')), 1, 'handles match by prefix');
select is((select count(*)::int from public.search_people('_5')), 0, '"_" is matched literally, not as a wildcard');
select is((select array_agg(handle) from public.search_people('eli_5')), array['eli_50'], 'literal "_" still matches');
select is((select count(*)::int from public.search_people('%%')), 0, '"%" is matched literally');

-- Follow B, C. B follows D; C follows D and E. D follows A.
select public.follow_user('00000000-0000-0000-0000-00000000070b');
select public.follow_user('00000000-0000-0000-0000-00000000070c');
reset role;
insert into public.follows (follower_id, followee_id) values
  ('00000000-0000-0000-0000-00000000070b', '00000000-0000-0000-0000-00000000070d'),
  ('00000000-0000-0000-0000-00000000070c', '00000000-0000-0000-0000-00000000070d'),
  ('00000000-0000-0000-0000-00000000070c', '00000000-0000-0000-0000-00000000070e'),
  ('00000000-0000-0000-0000-00000000070e', '00000000-0000-0000-0000-00000000070a');

-- Follow notifications
select is((select count(*)::int from public.notifications
           where kind = 'new_follower' and recipient_id = '00000000-0000-0000-0000-00000000070b'), 1,
  'following someone notifies them');
select is((select actor_id::text from public.notifications
           where kind = 'new_follower' and recipient_id = '00000000-0000-0000-0000-00000000070b'),
  '00000000-0000-0000-0000-00000000070a', 'with who followed');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000070a","role":"authenticated"}', true);
set local role authenticated;
select public.unfollow_user('00000000-0000-0000-0000-00000000070b');
select public.follow_user('00000000-0000-0000-0000-00000000070b');
reset role;
select is((select count(*)::int from public.notifications
           where kind = 'new_follower' and recipient_id = '00000000-0000-0000-0000-00000000070b'), 1,
  'unfollow and follow again does not notify twice');

update public.profile_private set notify_follows = false where profile_id = '00000000-0000-0000-0000-00000000070d';
insert into public.follows (follower_id, followee_id)
values ('00000000-0000-0000-0000-00000000070a', '00000000-0000-0000-0000-00000000070d');
select is((select count(*)::int from public.notifications
           where kind = 'new_follower' and recipient_id = '00000000-0000-0000-0000-00000000070d'
             and actor_id = '00000000-0000-0000-0000-00000000070a'), 0,
  'people who turned off follow notifications get none');
delete from public.follows
where follower_id = '00000000-0000-0000-0000-00000000070a' and followee_id = '00000000-0000-0000-0000-00000000070d';

set local role service_role;
select is((select actor_id::text || '|' || actor_name from public.claim_notifications(50)
           where kind = 'new_follower' and actor_id = '00000000-0000-0000-0000-00000000070a' limit 1),
  '00000000-0000-0000-0000-00000000070a|Amira Hassan', 'the sender gets the follower''s id and name');
reset role;

-- Suggestions
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000070a","role":"authenticated"}', true);
set local role authenticated;
create temp table s as select * from public.suggested_people(10);
select is((select handle from s limit 1), 'eli_50', 'people who follow you come first');
select is((select reason from s where handle = 'eli_50'), 'follows_you', 'with the reason');
select is((select mutual_count from s where handle = 'dev100'), 2, 'friends of friends count mutual follows');
select is((select mutual_name from s where handle = 'dev100'), 'Ben Kim', 'and name one of them');
select ok(not exists (select 1 from s where handle in ('amira', 'ben_k', 'cleo')),
  'never yourself or people you already follow');
select ok(not exists (select 1 from s where id = '00000000-0000-0000-0000-00000000070f'),
  'never people who have not finished signing up');

-- Contacts
select throws_ok($$select * from public.match_contacts(array['not-a-hash'])$$, '22023', 'invalid_hash',
  'only SHA-256 hex hashes are accepted');
select throws_ok($$select * from public.match_contacts(array_fill(repeat('a', 64), array[1001]))$$, '22023',
  'too_many_contacts', 'at most 1000 at a time');
select is((select array_agg(handle order by handle) from public.match_contacts(array[
            public.email_hash('user.0c@example.com'), public.email_hash(' USER.0E@example.com '),
            public.email_hash('user.0a@example.com'), public.email_hash('user.0f@example.com'),
            public.email_hash('nobody@example.com')])),
  array['cleo', 'eli_50'], 'contacts match onboarded accounts, never yourself or half-signed-up ones');
reset role;
update public.profile_private set findable_by_email = false where profile_id = '00000000-0000-0000-0000-00000000070e';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000070a","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.match_contacts(array[public.email_hash('user.0e@example.com')])), 0,
  'people can opt out of being found by email');
-- Three more checks make five today.
select count(*) from generate_series(1, 3) g, lateral public.match_contacts(array[public.email_hash('x' || g || '@example.com')]);
select throws_ok($$select * from public.match_contacts(array[public.email_hash('y@example.com')])$$, 'P0001',
  'contacts_rate_limited', 'a 6th contacts check in a day is refused');

-- Blocks hide people everywhere
reset role;
insert into public.blocks (blocker_id, blocked_id)
values ('00000000-0000-0000-0000-00000000070c', '00000000-0000-0000-0000-00000000070a');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000070a","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.search_people('cleo')), 0, 'blocked people don''t appear in search');

-- Settings
select lives_ok($$select public.set_findable_by_email(false)$$, 'A turns off being found by email');
select lives_ok($$select public.set_notification_preferences(p_follows => false)$$, 'and follow notifications');
select is((select findable_by_email::text || '|' || notify_follows || '|' || notify_messages from public.profile_private),
  'false|false|true', 'only those settings changed');

select * from finish();
rollback;
