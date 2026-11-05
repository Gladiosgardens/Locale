-- Global mode: no area needed; area-less posts are public everywhere; fashion interests.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000060a', 'g-a@example.com'),
  ('00000000-0000-0000-0000-00000000060b', 'g-b@example.com'),
  ('00000000-0000-0000-0000-00000000060c', 'g-c@example.com');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;

------------------------------------------------------------------------------
-- Interests
------------------------------------------------------------------------------
select ok((select count(*) from public.interests where active) >= 20, 'there are at least 20 active interests');
select is((select count(*)::int from public.interests where active and is_family), 0, 'no kid-related interest is active');
select ok(exists (select 1 from public.interests where slug = 'streetwear' and active), 'fashion interests exist');
select ok(not (select active from public.interests where slug = 'remote-work'), 'local interests are retired, not deleted');

------------------------------------------------------------------------------
-- Onboarding without an area
------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000060a","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.set_my_interests((select array_agg(id) from public.interests where slug in ('remote-work','new-in-town','teens')))$$,
  '22023', 'unknown_interest', 'retired interests cannot be chosen');
select lives_ok($$select public.set_my_interests((select array_agg(id) from public.interests where slug in ('streetwear','sneakers','minimalist')))$$,
  'active fashion interests can be chosen');
select lives_ok($$select public.complete_onboarding('ava_style', 'Ava', true)$$, 'onboarding works without an area');
select is((select area_id from public.profile_private), null, 'A has no area');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000060b","role":"authenticated"}', true);
set local role authenticated;
select public.set_my_interests((select array_agg(id) from public.interests where slug in ('menswear','luxury','jewelry')));
select public.complete_onboarding('ben_wears', 'Ben', true);
reset role;

------------------------------------------------------------------------------
-- Area-less posts are global
------------------------------------------------------------------------------
insert into storage.objects (bucket_id, name)
values ('post-media', '9a000000-0000-0000-0000-000000000001/0.jpg'), ('post-media', '9a000000-0000-0000-0000-000000000002/0.jpg');
set local role service_role;
select lives_ok($$select public.create_post_record('9a000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000060a', 'Fit check',
  (select array_agg(id) from public.interests where slug = 'streetwear'),
  '[{"path":"9a000000-0000-0000-0000-000000000001/0.jpg","width":1080,"height":1350}]',
  '[{"media":0,"x":0.4,"y":0.5,"item":{"title":"Cargo trousers","url":"https://example.com/cargo","price_cents":8900,"currency":"USD"}}]')$$,
  'a person without an area can post');
select throws_ok($$select public.create_post_record('9a000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-00000000060a', null,
  (select array_agg(id) from public.interests where slug = 'remote-work'),
  '[{"path":"9a000000-0000-0000-0000-000000000002/0.jpg","width":1,"height":1}]')$$,
  '22023', 'unknown_interest', 'retired interests cannot tag new posts');
select throws_ok($$select public.create_post_record('9a000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-00000000060c', null, '{}',
  '[{"path":"9a000000-0000-0000-0000-000000000002/0.jpg","width":1,"height":1}]')$$,
  '22023', 'not_onboarded', 'people who have not finished onboarding still cannot post');
reset role;
select is((select area_id from public.posts where id = '9a000000-0000-0000-0000-000000000001'), null, 'the post has no area');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000060b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.discover_posts() where id = '9a000000-0000-0000-0000-000000000001'), 1,
  'B sees A''s post in For You');
select is((select area_name from public.discover_posts() where id = '9a000000-0000-0000-0000-000000000001'), null,
  'with no area shown');
select is((select count(*)::int from public.discover_posts('cargo')), 1, 'and finds it by item search');
select is((select caption from public.discover_posts(p_post_id => '9a000000-0000-0000-0000-000000000001')), 'Fit check',
  'a single post can be fetched by id');
select is((select count(*)::int from storage.objects where name like '9a000000-0000-0000-0000-000000000001/%'), 1,
  'B can load its image');
select is((select count(*)::int from public.nearby_feed()), 0, 'area-less posts do not appear in a Nearby feed');
select public.follow_user('00000000-0000-0000-0000-00000000060a');
select is((select count(*)::int from public.discover_posts(p_following => true)), 1, 'Following shows it after following A');
select lives_ok($$select public.report_content('post', '9a000000-0000-0000-0000-000000000001', 'spam')$$,
  'global posts can be reported');

select * from finish();
rollback;
