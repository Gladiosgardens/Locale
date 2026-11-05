-- Follows, profile summaries and the Following / per-author feeds.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- These tests cover the local features, which use interests retired in global mode.
update public.interests set active = true;

-- A and B near Downtown, F in Los Angeles.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000030a', 'a3@example.com'),
  ('00000000-0000-0000-0000-00000000030b', 'b3@example.com'),
  ('00000000-0000-0000-0000-00000000030f', 'f3@example.com');
insert into public.areas (geohash5, name, center_lat, center_lng)
select g, n, (public.geohash_center(g)).lat, (public.geohash_center(g)).lng
from (values ('9q9k5', 'Downtown'), ('9q5ct', 'Los Angeles')) as v(g, n)
on conflict (geohash5) do nothing;
update public.profile_private pp set adult_confirmed_at = now(),
  area_id = (select id from public.areas where geohash5 = case when pp.profile_id::text like '%30f' then '9q5ct' else '9q9k5' end)
where pp.profile_id::text like '00000000-0000-0000-0000-00000000030%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), bio = 'Hi', onboarded_at = now()
from (values ('00000000-0000-0000-0000-00000000030a'::uuid, 'avi'),
             ('00000000-0000-0000-0000-00000000030b'::uuid, 'bex'),
             ('00000000-0000-0000-0000-00000000030f'::uuid, 'fen')) as v(id, h)
where p.id = v.id;

insert into storage.objects (bucket_id, name)
select 'post-media', p || '/0.jpg'
from unnest(array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
                  'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004']) as p;
set local role service_role;
-- A: one public post, one nearby-only post, one kid-tagged post. B: one public post.
select public.create_post_record('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000030a',
  'Public', '{}', '[{"path":"d0000000-0000-0000-0000-000000000001/0.jpg","width":1,"height":1}]');
select public.create_post_record('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000030a',
  'Local only', '{}', '[{"path":"d0000000-0000-0000-0000-000000000002/0.jpg","width":1,"height":1}]', '[]', false);
select public.create_post_record('d0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000030a',
  'Kids', array[3]::smallint[], '[{"path":"d0000000-0000-0000-0000-000000000003/0.jpg","width":1,"height":1}]');
select public.create_post_record('d0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000030b',
  'Bex public', '{}', '[{"path":"d0000000-0000-0000-0000-000000000004/0.jpg","width":1,"height":1}]');
reset role;

------------------------------------------------------------------------------
-- F (far away) follows A
------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000030f","role":"authenticated"}', true);
set local role authenticated;

select throws_ok($$select public.follow_user('00000000-0000-0000-0000-00000000030f')$$, '22023',
  'cannot_follow_self', 'you cannot follow yourself');
select throws_ok($$insert into public.follows values ('00000000-0000-0000-0000-00000000030f',
  '00000000-0000-0000-0000-00000000030a')$$, '42501', null, 'follows are created through the RPC only');
select lives_ok($$select public.follow_user('00000000-0000-0000-0000-00000000030a')$$, 'F follows A');
select lives_ok($$select public.follow_user('00000000-0000-0000-0000-00000000030a')$$, 'following twice is harmless');

select is((select i_follow::text || '|' || follower_count from public.profile_summary('00000000-0000-0000-0000-00000000030a')),
  'true|1', 'A''s profile shows F follows them');
select is((select array_agg(id::text) from public.discover_posts(p_following => true)),
  array['d0000000-0000-0000-0000-000000000001'],
  'F''s Following feed has A''s public post only, not nearby-only or kid-tagged ones');
select is((select area_name from public.discover_posts(p_following => true)), null,
  'and does not reveal A''s area');
select is((select array_agg(id::text) from public.discover_posts(p_author_id => '00000000-0000-0000-0000-00000000030a')),
  array['d0000000-0000-0000-0000-000000000001'], 'A''s profile shows F only what F may see');

------------------------------------------------------------------------------
-- B (nearby) follows A
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000030b","role":"authenticated"}', true);
set local role authenticated;
select public.follow_user('00000000-0000-0000-0000-00000000030a');
select is((select count(*)::int from public.discover_posts(p_following => true)), 3,
  'B, nearby, sees all three of A''s posts in Following');
select is((select count(*)::int from public.discover_posts(p_following => true)
           where author_id = '00000000-0000-0000-0000-00000000030b'), 0,
  'Following does not include B''s own posts');
select is((select count(*)::int from public.discover_posts(p_author_id => '00000000-0000-0000-0000-00000000030b')), 1,
  'B''s own profile lists B''s posts');

------------------------------------------------------------------------------
-- A sees followers count but not the lists of others
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000030a","role":"authenticated"}', true);
set local role authenticated;
select is((select follower_count from public.profile_summary('00000000-0000-0000-0000-00000000030a')), 2,
  'A has two followers');
select is((select count(*)::int from public.follows where followee_id = '00000000-0000-0000-0000-00000000030a'), 2,
  'A can see who follows A');
select is((select follows_me::text || '|' || i_follow from public.profile_summary('00000000-0000-0000-0000-00000000030b')),
  'true|false', 'A sees that B follows them and A does not follow B yet');
select lives_ok($$select public.follow_user('00000000-0000-0000-0000-00000000030b')$$, 'A follows B back');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000030f","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.follows where followee_id = '00000000-0000-0000-0000-00000000030b'), 0,
  'F cannot see who follows B');
select is((select following_count from public.profile_summary('00000000-0000-0000-0000-00000000030a')), 1,
  'but can see the count');
select is((select is_me from public.profile_summary('00000000-0000-0000-0000-00000000030f')), true,
  'profile_summary flags your own profile');

------------------------------------------------------------------------------
-- Blocking ends follows and hides profiles
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000030a","role":"authenticated"}', true);
set local role authenticated;
select public.block_user('00000000-0000-0000-0000-00000000030f');
select is((select follower_count from public.profile_summary('00000000-0000-0000-0000-00000000030a')), 1,
  'blocking F removed F''s follow');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000030f","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.profile_summary('00000000-0000-0000-0000-00000000030a')), 0,
  'F can no longer load A''s profile');
select throws_ok($$select public.follow_user('00000000-0000-0000-0000-00000000030a')$$, 'P0002',
  'profile_not_found', 'nor follow A again');
select is((select count(*)::int from public.discover_posts(p_author_id => '00000000-0000-0000-0000-00000000030a')), 0,
  'nor see A''s posts');
select lives_ok($$select public.unfollow_user('00000000-0000-0000-0000-00000000030a')$$, 'unfollow is always safe');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select * from public.profile_summary('00000000-0000-0000-0000-00000000030a')$$, '42501', null,
  'anon cannot load profiles');
select throws_ok($$select public.follow_user('00000000-0000-0000-0000-00000000030a')$$, '42501', null,
  'anon cannot follow');

select * from finish();
rollback;
