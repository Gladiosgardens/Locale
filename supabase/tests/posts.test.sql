-- RLS, storage and RPC tests for posts and the nearby feed.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- Fixtures (as postgres). Cells: A 9q9k5; B 9q9k7 (north neighbour);
-- C 9q9kj (two cells east: just outside); D 9q5ct (Los Angeles); E not onboarded.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'c@example.com'),
  ('00000000-0000-0000-0000-0000000000d1', 'd@example.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'e@example.com');

insert into public.areas (geohash5, name, center_lat, center_lng)
select g, n, (public.geohash_center(g)).lat, (public.geohash_center(g)).lng
from (values ('9q9k5', 'Downtown'), ('9q9k7', 'Northside'), ('9q9kj', 'East Hills'),
             ('9q5ct', 'Los Angeles')) as v(g, n);

update public.profile_private pp set area_id = a.id, adult_confirmed_at = now()
from (values ('00000000-0000-0000-0000-0000000000a1'::uuid, '9q9k5'),
             ('00000000-0000-0000-0000-0000000000b1'::uuid, '9q9k7'),
             ('00000000-0000-0000-0000-0000000000c1'::uuid, '9q9kj'),
             ('00000000-0000-0000-0000-0000000000d1'::uuid, '9q5ct'),
             ('00000000-0000-0000-0000-0000000000e1'::uuid, '9q9k5')) as v(uid, g)
join public.areas a on a.geohash5 = v.g
where pp.profile_id = v.uid;

update public.profiles set handle = h, display_name = initcap(h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-0000000000a1'::uuid, 'ana'),
             ('00000000-0000-0000-0000-0000000000b1'::uuid, 'ben'),
             ('00000000-0000-0000-0000-0000000000c1'::uuid, 'cal'),
             ('00000000-0000-0000-0000-0000000000d1'::uuid, 'dee')) as v(uid, h)
where id = v.uid;

-- Images the Edge Function would have written.
insert into storage.objects (bucket_id, name) values
  ('post-media', '11111111-1111-1111-1111-111111111111/0.jpg'),
  ('post-media', '11111111-1111-1111-1111-111111111111/1.jpg'),
  ('post-media', '22222222-2222-2222-2222-222222222222/0.jpg'),
  ('post-media', '33333333-3333-3333-3333-333333333333/0.jpg'),
  ('post-media', '44444444-4444-4444-4444-444444444444/0.jpg');

select ok((select bool_and(is_family) from public.interests
           where slug in ('toddlers', 'school-age-kids', 'teens'))
      and not (select bool_or(is_family) from public.interests
               where slug not in ('toddlers', 'school-age-kids', 'teens')),
  'only the three kid-related interests are flagged as family');

------------------------------------------------------------------------------
-- Write path is service-role only
------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

select throws_ok($$select public.create_post_record('11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-0000000000a1', 'hi', '{}',
  '[{"path":"11111111-1111-1111-1111-111111111111/0.jpg","width":10,"height":10}]')$$,
  '42501', null, 'users cannot call create_post_record');
select throws_ok($$insert into public.posts (author_id, area_id)
  select '00000000-0000-0000-0000-0000000000a1', id from public.areas limit 1$$,
  '42501', null, 'users cannot insert posts directly');
select throws_ok($$insert into public.post_media (post_id, storage_path, width, height, position)
  values (gen_random_uuid(), 'x/0.jpg', 1, 1, 0)$$, '42501', null,
  'users cannot insert media rows directly');

reset role;
set local role service_role;

select throws_ok($$select public.create_post_record('55555555-5555-5555-5555-555555555555',
  '00000000-0000-0000-0000-0000000000e1', null, '{}',
  '[{"path":"55555555-5555-5555-5555-555555555555/0.jpg","width":10,"height":10}]')$$,
  '22023', 'not_onboarded', 'users who have not finished onboarding cannot post');
select throws_ok($$select public.create_post_record('55555555-5555-5555-5555-555555555555',
  '00000000-0000-0000-0000-0000000000a1', null, '{}', '[]')$$,
  '22023', 'media_count', 'a post needs at least one image');
select throws_ok($$select public.create_post_record('55555555-5555-5555-5555-555555555555',
  '00000000-0000-0000-0000-0000000000a1', null, array[1,2,3,4]::smallint[],
  '[{"path":"55555555-5555-5555-5555-555555555555/0.jpg","width":10,"height":10}]')$$,
  '22023', 'too_many_interests', 'at most 3 interests per post');
select throws_ok($$select public.create_post_record('55555555-5555-5555-5555-555555555555',
  '00000000-0000-0000-0000-0000000000a1', null, '{}',
  '[{"path":"11111111-1111-1111-1111-111111111111/0.jpg","width":10,"height":10}]')$$,
  '22023', 'bad_media_path', 'media must live under the post''s own folder');
select throws_ok($$select public.create_post_record('55555555-5555-5555-5555-555555555555',
  '00000000-0000-0000-0000-0000000000a1', null, '{}',
  '[{"path":"55555555-5555-5555-5555-555555555555/0.jpg","width":10,"height":10}]')$$,
  '22023', 'media_missing', 'media must already exist in storage');
select is((select count(*)::int from public.posts), 0, 'failed attempts leave no posts');

select lives_ok($$select public.create_post_record('11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-0000000000a1', '  First walk with Pepper  ',
  array[1, 6]::smallint[],
  '[{"path":"11111111-1111-1111-1111-111111111111/0.jpg","width":2048,"height":1536},
    {"path":"11111111-1111-1111-1111-111111111111/1.jpg","width":1536,"height":2048}]')$$,
  'A posts two photos with two interests');
select is((select caption from public.posts where id = '11111111-1111-1111-1111-111111111111'),
  'First walk with Pepper', 'caption is trimmed');
select is((select a.geohash5 from public.posts p join public.areas a on a.id = p.area_id
           where p.id = '11111111-1111-1111-1111-111111111111'),
  '9q9k5', 'post takes the author''s area');

-- Older posts from B and D, and a newer one from C, for feed ordering.
select public.create_post_record('22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-0000000000b1', 'Coffee meetup?', array[12]::smallint[],
  '[{"path":"22222222-2222-2222-2222-222222222222/0.jpg","width":800,"height":800}]');
select public.create_post_record('33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-0000000000c1', 'Just outside', '{}',
  '[{"path":"33333333-3333-3333-3333-333333333333/0.jpg","width":800,"height":800}]');
select public.create_post_record('44444444-4444-4444-4444-444444444444',
  '00000000-0000-0000-0000-0000000000d1', 'From LA', '{}',
  '[{"path":"44444444-4444-4444-4444-444444444444/0.jpg","width":800,"height":800}]');
reset role;
update public.posts set published_at = now() - interval '1 hour'
where id = '22222222-2222-2222-2222-222222222222';

------------------------------------------------------------------------------
-- Visibility (as B, north neighbour of A)
------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select array_agg(id::text order by published_at desc) from public.nearby_feed()),
  array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
  'B sees A''s neighbouring post and their own, newest first; not C (2 cells away) or D (LA)');
select is((select media -> 1 ->> 'path' from public.nearby_feed()
           where id = '11111111-1111-1111-1111-111111111111'),
  '11111111-1111-1111-1111-111111111111/1.jpg', 'feed returns media in order');
select is((select author_handle || '|' || area_name from public.nearby_feed()
           where id = '11111111-1111-1111-1111-111111111111'),
  'ana|Downtown', 'feed returns author and area name');
select is((select count(*)::int from public.nearby_feed(p_interest_id => 12::smallint)), 1,
  'interest filter narrows the feed');
select is(
  (select array_agg(id::text) from public.nearby_feed(
     p_limit => 1,
     p_before_published_at => (select published_at from public.posts
                               where id = '11111111-1111-1111-1111-111111111111'),
     p_before_id => '11111111-1111-1111-1111-111111111111')),
  array['22222222-2222-2222-2222-222222222222'], 'keyset pagination returns the next page');
select is((select count(*)::int from public.posts
           where id in ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444')),
  0, 'B cannot read far-away posts from the table directly');
select is((select count(*)::int from public.post_media
           where post_id = '44444444-4444-4444-4444-444444444444'), 0,
  'B cannot read far-away media rows');
select is((select count(*)::int from storage.objects
           where name like '11111111-1111-1111-1111-111111111111/%'), 2,
  'B can download A''s images');
select is((select count(*)::int from storage.objects
           where name like '44444444-4444-4444-4444-444444444444/%'), 0,
  'B cannot download far-away images');

-- Storage writes
select lives_ok($$insert into storage.objects (bucket_id, name)
  values ('post-uploads', '00000000-0000-0000-0000-0000000000b1/x.jpg')$$,
  'B can upload into their own holding folder');
select throws_ok($$insert into storage.objects (bucket_id, name)
  values ('post-uploads', '00000000-0000-0000-0000-0000000000a1/x.jpg')$$,
  '42501', null, 'B cannot upload into A''s folder');
select throws_ok($$insert into storage.objects (bucket_id, name)
  values ('post-media', '11111111-1111-1111-1111-111111111111/9.jpg')$$,
  '42501', null, 'B cannot write to the published media bucket');
select is((select count(*)::int from storage.objects where bucket_id = 'post-uploads'), 0,
  'B cannot read holding uploads, even their own');

select throws_ok($$select public.delete_my_post('11111111-1111-1111-1111-111111111111')$$,
  'P0002', 'post_not_found', 'B cannot delete A''s post');

------------------------------------------------------------------------------
-- As C (two cells east of A, not adjacent to B) and D
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(id::text) from public.nearby_feed()),
  array['33333333-3333-3333-3333-333333333333'],
  'C, two cells east of A, sees only their own post');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(id::text) from public.nearby_feed()),
  array['44444444-4444-4444-4444-444444444444'], 'D in LA sees only their own post');

------------------------------------------------------------------------------
-- Deletion (as A) and anonymous access
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.delete_my_post('11111111-1111-1111-1111-111111111111')$$,
  'A deletes their post');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.nearby_feed()
           where id = '11111111-1111-1111-1111-111111111111'), 0,
  'a deleted post leaves the feed');
select is((select count(*)::int from storage.objects
           where name like '11111111-1111-1111-1111-111111111111/%'), 0,
  'a deleted post''s images are no longer downloadable');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select * from public.nearby_feed()', '42501', null, 'anon cannot call the feed');
select throws_ok('select * from public.posts', '42501', null, 'anon cannot read posts');

------------------------------------------------------------------------------
-- Rate limit (as service role)
------------------------------------------------------------------------------
reset role;
-- Pretend D already posted 19 more times today.
insert into public.posts (author_id, area_id)
select '00000000-0000-0000-0000-0000000000d1', area_id
from public.profile_private, generate_series(1, 19)
where profile_id = '00000000-0000-0000-0000-0000000000d1';
insert into storage.objects (bucket_id, name)
values ('post-media', '66666666-6666-6666-6666-666666666666/0.jpg');
set local role service_role;
select throws_ok($$select public.create_post_record('66666666-6666-6666-6666-666666666666',
  '00000000-0000-0000-0000-0000000000d1', null, '{}',
  '[{"path":"66666666-6666-6666-6666-666666666666/0.jpg","width":10,"height":10}]')$$,
  'P0001', 'post_rate_limited', 'the 21st post within 24h is refused');

select * from finish();
rollback;
