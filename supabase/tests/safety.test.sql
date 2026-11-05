-- Blocking and reporting.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- These tests cover the local features, which use interests retired in global mode.
update public.interests set active = true;

-- Fixtures: A, B, C, D, E all near Downtown; F in Los Angeles.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000002' || x)::uuid, x || '@example.com'
from unnest(array['0a', '0b', '0c', '0d', '0e', '0f']) as x;

insert into public.areas (geohash5, name, center_lat, center_lng)
select g, n, (public.geohash_center(g)).lat, (public.geohash_center(g)).lng
from (values ('9q9k5', 'Downtown'), ('9q5ct', 'Los Angeles')) as v(g, n)
on conflict (geohash5) do nothing;

update public.profile_private pp
set area_id = (select id from public.areas where geohash5 = case when pp.profile_id::text like '%20f' then '9q5ct' else '9q9k5' end),
    adult_confirmed_at = now()
where pp.profile_id::text like '00000000-0000-0000-0000-0000000002%';

update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-00000000020a'::uuid, 'ari'),
             ('00000000-0000-0000-0000-00000000020b'::uuid, 'bea'),
             ('00000000-0000-0000-0000-00000000020c'::uuid, 'cy'),
             ('00000000-0000-0000-0000-00000000020d'::uuid, 'dov'),
             ('00000000-0000-0000-0000-00000000020e'::uuid, 'eli'),
             ('00000000-0000-0000-0000-00000000020f'::uuid, 'fox')) as v(id, h)
where p.id = v.id and char_length(v.h) >= 3;
-- 'cy' is too short for a handle; give C a valid one.
update public.profiles set handle = 'cyd', display_name = 'Cyd', onboarded_at = now()
where id = '00000000-0000-0000-0000-00000000020c';

insert into storage.objects (bucket_id, name)
select 'post-media', p || '/0.jpg'
from unnest(array['c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000b',
                  'c0000000-0000-0000-0000-00000000000c']) as p;

set local role service_role;
select public.create_post_record('c0000000-0000-0000-0000-00000000000a',
  '00000000-0000-0000-0000-00000000020a', 'Ari''s public post', '{}',
  '[{"path":"c0000000-0000-0000-0000-00000000000a/0.jpg","width":10,"height":10}]',
  '[{"media":0,"x":0.5,"y":0.5,"item":{"title":"Rattan chair"}}]');
select public.create_post_record('c0000000-0000-0000-0000-00000000000b',
  '00000000-0000-0000-0000-00000000020b', 'Bea''s post', '{}',
  '[{"path":"c0000000-0000-0000-0000-00000000000b/0.jpg","width":10,"height":10}]');
select public.create_post_record('c0000000-0000-0000-0000-00000000000c',
  '00000000-0000-0000-0000-00000000020c', 'Cyd''s post', '{}',
  '[{"path":"c0000000-0000-0000-0000-00000000000c/0.jpg","width":10,"height":10}]');
reset role;

------------------------------------------------------------------------------
-- Blocking (A blocks B)
------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000020a","role":"authenticated"}', true);
set local role authenticated;

select throws_ok($$select public.block_user('00000000-0000-0000-0000-00000000020a')$$, '22023',
  'cannot_block_self', 'you cannot block yourself');
select throws_ok($$insert into public.blocks values ('00000000-0000-0000-0000-00000000020a',
  '00000000-0000-0000-0000-00000000020b')$$, '42501', null, 'blocks are created through the RPC only');
select lives_ok($$select public.block_user('00000000-0000-0000-0000-00000000020b')$$, 'A blocks B');
select lives_ok($$select public.block_user('00000000-0000-0000-0000-00000000020b')$$, 'blocking twice is harmless');

select is((select count(*)::int from public.nearby_feed() where author_id = '00000000-0000-0000-0000-00000000020b'), 0,
  'A no longer sees B''s posts in Nearby');
select is((select count(*)::int from public.discover_posts() where author_id = '00000000-0000-0000-0000-00000000020b'), 0,
  'or Everywhere');
select is((select count(*)::int from public.posts where author_id = '00000000-0000-0000-0000-00000000020b'), 0,
  'or the posts table');
select is((select count(*)::int from storage.objects where name like 'c0000000-0000-0000-0000-00000000000b/%'), 0,
  'or B''s images');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-00000000020b'), 0,
  'or B''s profile');
select is((select array_agg(handle) from public.my_blocked_profiles()), array['bea'],
  'A sees B in their blocked list');
select is((select count(*)::int from public.nearby_feed() where author_id = '00000000-0000-0000-0000-00000000020c'), 1,
  'other people are unaffected');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000020b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.nearby_feed() where author_id = '00000000-0000-0000-0000-00000000020a'), 0,
  'B no longer sees A''s posts either (two-way)');
select is((select count(*)::int from public.discover_posts('rattan')), 0, 'nor finds A''s items in search');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-00000000020a'), 0,
  'nor A''s profile');
select is((select count(*)::int from public.blocks), 0, 'B cannot see that A blocked them');
select throws_ok($$select public.report_content('post', 'c0000000-0000-0000-0000-00000000000a', 'spam')$$,
  'P0002', 'report_target_not_found', 'B cannot report a post they cannot see');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000020a","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.unblock_user('00000000-0000-0000-0000-00000000020b')$$, 'A unblocks B');
select is((select count(*)::int from public.nearby_feed() where author_id = '00000000-0000-0000-0000-00000000020b'), 1,
  'and sees B''s posts again');

------------------------------------------------------------------------------
-- Reporting
------------------------------------------------------------------------------
-- C reports A's post as spam (1 reporter, not hidden yet).
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000020c","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.report_content('post', 'c0000000-0000-0000-0000-00000000000a', 'spam', '  Ads  ')$$,
  'C reports A''s post');
select lives_ok($$select public.report_content('post', 'c0000000-0000-0000-0000-00000000000a', 'scam')$$,
  'reporting the same thing again is a no-op');
select is((select count(*)::int || '|' || max(details) from public.reports), '1|Ads', 'C sees one report of their own');
select throws_ok($$select public.report_content('post', 'c0000000-0000-0000-0000-00000000000a', 'boring')$$,
  '22023', 'invalid_report', 'unknown reasons are rejected');
select throws_ok($$select public.report_content('profile', '00000000-0000-0000-0000-00000000020c', 'spam')$$,
  'P0002', 'report_target_not_found', 'you cannot report yourself');
select lives_ok($$select public.report_content('profile', '00000000-0000-0000-0000-00000000020a', 'harassment')$$,
  'profiles can be reported');
select throws_ok($$insert into public.reports (reporter_id, target_type, target_id, reason)
  values ('00000000-0000-0000-0000-00000000020c', 'post', gen_random_uuid(), 'spam')$$, '42501', null,
  'reports are created through the RPC only');

-- D reports too: 2 reporters, still visible.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000020d","role":"authenticated"}', true);
set local role authenticated;
select public.report_content('post', 'c0000000-0000-0000-0000-00000000000a', 'spam');
select is((select count(*)::int from public.reports), 1, 'D cannot see other people''s reports');
select is((select count(*)::int from public.nearby_feed() where id = 'c0000000-0000-0000-0000-00000000000a'), 1,
  'two reporters do not hide a post');

-- E reports: 3 reporters -> hidden.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000020e","role":"authenticated"}', true);
set local role authenticated;
select public.report_content('post', 'c0000000-0000-0000-0000-00000000000a', 'other');
select is((select count(*)::int from public.nearby_feed() where id = 'c0000000-0000-0000-0000-00000000000a'), 0,
  'a third reporter hides the post pending review');
select is((select count(*)::int from storage.objects where name like 'c0000000-0000-0000-0000-00000000000a/%'), 0,
  'its images are hidden too');

-- One child-safety report hides immediately (E reports C's post).
select lives_ok($$select public.report_content('post', 'c0000000-0000-0000-0000-00000000000c', 'child_safety')$$,
  'E reports Cyd''s post for child safety');
select is((select count(*)::int from public.discover_posts() where id = 'c0000000-0000-0000-0000-00000000000c'), 0,
  'one child-safety report hides it everywhere');

-- F in LA can report a globally visible post only if they can see it.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000020f","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.report_content('post', 'c0000000-0000-0000-0000-00000000000b', 'scam')$$,
  'far-away viewers can report public posts they found');
select throws_ok($$select * from public.moderation_queue$$, '42501', null, 'users cannot read the moderation queue');
select throws_ok($$select public.resolve_report('post', 'c0000000-0000-0000-0000-00000000000b', 'dismiss')$$,
  '42501', null, 'users cannot resolve reports');

------------------------------------------------------------------------------
-- Review (service role)
------------------------------------------------------------------------------
reset role;
set local role service_role;
select is((select target_id::text from public.moderation_queue limit 1), 'c0000000-0000-0000-0000-00000000000c',
  'child-safety reports are first in the queue');
select is((select reporters::int from public.moderation_queue where target_id = 'c0000000-0000-0000-0000-00000000000a'), 3,
  'the queue counts distinct reporters');
select lives_ok($$select public.resolve_report('post', 'c0000000-0000-0000-0000-00000000000a', 'dismiss')$$,
  'dismissing A''s reports');
select is((select status from public.posts where id = 'c0000000-0000-0000-0000-00000000000a'), 'published',
  'restores the hidden post');
select lives_ok($$select public.resolve_report('post', 'c0000000-0000-0000-0000-00000000000c', 'remove')$$,
  'removing Cyd''s post');
select is((select status from public.posts where id = 'c0000000-0000-0000-0000-00000000000c'), 'removed',
  'takes it down for good');
select throws_ok($$select public.resolve_report('post', 'c0000000-0000-0000-0000-00000000000c', 'remove')$$,
  'P0002', 'report_not_found', 'resolved targets leave the queue');

select * from finish();
rollback;
