-- Creator stats: views, item opens and link taps, visible only to the author.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

update public.interests set active = true;
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000000f' || x)::uuid, x || 'c@example.com' from unnest(array['0a', '0b', '0c', '0d']) x;
update public.profile_private set adult_confirmed_at = now() where profile_id::text like '00000000-0000-0000-0000-000000000f%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-000000000f0a'::uuid, 'st_ana'), ('00000000-0000-0000-0000-000000000f0b'::uuid, 'st_ben'),
             ('00000000-0000-0000-0000-000000000f0c'::uuid, 'st_cy'), ('00000000-0000-0000-0000-000000000f0d'::uuid, 'st_dee')) v(id, h)
where p.id = v.id;
insert into storage.objects (bucket_id, name) values ('post-media', 'ff000000-0000-0000-0000-000000000001/0.jpg');
set local role service_role;
select public.create_post_record('ff000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f0a',
  'Desk', '{}', '[{"path":"ff000000-0000-0000-0000-000000000001/0.jpg","width":1,"height":1}]',
  '[{"media":0,"x":0.2,"y":0.2,"item":{"title":"Oak desk","url":"https://shop.example.com/desk"}},
    {"media":0,"x":0.6,"y":0.6,"item":{"title":"Lamp"}}]');
reset role;
create temp table ids as
select it.title, it.id from public.items it join public.item_tags t on t.item_id = it.id
join public.post_media m on m.id = t.post_media_id where m.post_id = 'ff000000-0000-0000-0000-000000000001';
grant select on ids to authenticated;
-- Dee blocks Ana.
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-000000000f0d', '00000000-0000-0000-0000-000000000f0a');

-- Ben views twice, opens the desk and taps its link; likes and saves
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f0b","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.record_post_views(array['ff000000-0000-0000-0000-000000000001'::uuid])$$, 'a view is recorded');
select public.record_post_views(array['ff000000-0000-0000-0000-000000000001'::uuid]);
select public.record_item_event('ff000000-0000-0000-0000-000000000001', (select id from ids where title = 'Oak desk'), 'open');
select public.record_item_event('ff000000-0000-0000-0000-000000000001', (select id from ids where title = 'Oak desk'), 'link');
select public.set_post_like('ff000000-0000-0000-0000-000000000001', true);
select public.set_post_saved('ff000000-0000-0000-0000-000000000001', true);
select public.set_item_saved((select id from ids where title = 'Oak desk'), 'ff000000-0000-0000-0000-000000000001', true);
select public.record_item_event('ff000000-0000-0000-0000-000000000001', gen_random_uuid(), 'open');
select throws_ok($$select public.record_item_event('ff000000-0000-0000-0000-000000000001', (select id from ids where title = 'Lamp'), 'buy')$$,
  '22023', 'bad_request', 'only open and link events');
select throws_ok($$select public.post_stats('ff000000-0000-0000-0000-000000000001')$$, 'P0002', 'post_not_found',
  'only the author sees a post''s stats');
select is((select count(*)::int from public.my_stats()), 1, 'my_stats only covers my own posts');
select is((select reach from public.my_stats()), 0, 'and Ben has no reach of his own');
reset role;
select is((select view_count from public.post_views where viewer_id = '00000000-0000-0000-0000-000000000f0b'), 1,
  'repeat views within minutes count once');
select is((select count(*)::int from public.item_events where viewer_id = '00000000-0000-0000-0000-000000000f0b'), 2,
  'events for items not on the post are ignored');

-- Cy views and opens the lamp; Dee (blocked) and Ana herself don't count
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f0c","role":"authenticated"}', true);
set local role authenticated;
select public.record_post_views(array['ff000000-0000-0000-0000-000000000001'::uuid]);
select public.record_item_event('ff000000-0000-0000-0000-000000000001', (select id from ids where title = 'Lamp'), 'open');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f0d","role":"authenticated"}', true);
set local role authenticated;
select public.record_post_views(array['ff000000-0000-0000-0000-000000000001'::uuid]);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f0a","role":"authenticated"}', true);
set local role authenticated;
select public.record_post_views(array['ff000000-0000-0000-0000-000000000001'::uuid]);
select public.record_item_event('ff000000-0000-0000-0000-000000000001', (select id from ids where title = 'Lamp'), 'open');

-- Ana's stats
select is((select reach || '/' || views from public.post_stats('ff000000-0000-0000-0000-000000000001')), '2/2',
  'reach and views skip the author and blocked people');
select is((select likes || '/' || comments || '/' || saves from public.post_stats('ff000000-0000-0000-0000-000000000001')), '1/0/1',
  'likes, comments and saves');
select is((select item_opens || '/' || link_taps from public.post_stats('ff000000-0000-0000-0000-000000000001')), '2/1',
  'people who opened items and tapped through');
select is((select jsonb_path_query_array(items, '$[*].title') from public.post_stats('ff000000-0000-0000-0000-000000000001')),
  '["Oak desk", "Lamp"]'::jsonb, 'each tagged item is listed');
select is((select items -> 0 ->> 'opens' || '/' || (items -> 0 ->> 'link_taps') || '/' || (items -> 0 ->> 'wishlist')
           from public.post_stats('ff000000-0000-0000-0000-000000000001')), '1/1/1', 'with opens, link taps and wishlist saves');
select is((select reach || '/' || likes || '/' || saves || '/' || item_opens || '/' || link_taps from public.my_stats()), '2/1/1/2/1',
  'the 30-day summary adds them up');
select is((select posts -> 0 ->> 'post_id' from public.my_stats()), 'ff000000-0000-0000-0000-000000000001', 'and lists the post');
select throws_ok($$select public.record_post_views(array_fill(gen_random_uuid(), array[51]))$$, '22023', 'too_many',
  'view batches are capped');
reset role;
select is((select count(*)::int from public.item_events where viewer_id = '00000000-0000-0000-0000-000000000f0a'), 0,
  'authors'' own taps aren''t counted');

select * from finish();
rollback;
