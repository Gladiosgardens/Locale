-- Stories: 24-hour posts kept out of feeds, with views and highlights.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

update public.interests set active = true;
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000000e' || x)::uuid, x || 's@example.com' from unnest(array['0a', '0b', '0c']) x;
update public.profile_private set adult_confirmed_at = now() where profile_id::text like '00000000-0000-0000-0000-000000000e%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-000000000e0a'::uuid, 'sto_ana'), ('00000000-0000-0000-0000-000000000e0b'::uuid, 'sto_ben'),
             ('00000000-0000-0000-0000-000000000e0c'::uuid, 'sto_cy')) v(id, h)
where p.id = v.id;
-- Ben follows Ana; Cy follows nobody; Cy blocks Ana later.
insert into public.follows (follower_id, followee_id) values ('00000000-0000-0000-0000-000000000e0b', '00000000-0000-0000-0000-000000000e0a');
delete from public.notifications;

insert into storage.objects (bucket_id, name)
select 'post-media', p || '/0.jpg'
from unnest(array['ee000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000002',
                  'ee000000-0000-0000-0000-000000000003', 'ee000000-0000-0000-0000-000000000004']) as p;

set local role service_role;
select throws_ok($$select public.create_story_record('ee000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000e0a', null,
  '[{"path":"a","width":1,"height":1},{"path":"b","width":1,"height":1}]')$$, '22023', 'media_count', 'a story is one photo or video');
select lives_ok($$select public.create_story_record('ee000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000e0a',
  'Desk day @sto_ben #desk', '[{"path":"ee000000-0000-0000-0000-000000000001/0.jpg","width":10,"height":20}]',
  '[{"media":0,"x":0.5,"y":0.5,"item":{"title":"Oak desk","url":"https://example.com/desk"}}]')$$, 'Ana posts a story with a tagged item');
select public.create_story_record('ee000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000e0a',
  null, '[{"path":"ee000000-0000-0000-0000-000000000002/0.jpg","width":10,"height":20}]');
-- A regular post for comparison.
select public.create_post_record('ee000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000e0a',
  'A post', '{}', '[{"path":"ee000000-0000-0000-0000-000000000003/0.jpg","width":1,"height":1}]');
reset role;

select is((select kind || ':' || (expires_at > now() + interval '23 hours')::text from public.posts where id = 'ee000000-0000-0000-0000-000000000001'),
  'story:true', 'stories expire in 24 hours');
select is((select count(*)::int from public.notifications where kind = 'mention'), 0, 'mentions in stories don''t notify');
select is((select count(*)::int from public.post_hashtags where post_id = 'ee000000-0000-0000-0000-000000000001'), 0,
  'and their hashtags aren''t indexed');
select is((select count(*)::int from public.item_tags t join public.post_media m on m.id = t.post_media_id
           where m.post_id = 'ee000000-0000-0000-0000-000000000001'), 1, 'item tags work on stories');

-- Ben's view
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000e0b","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(id::text) from public.discover_posts(p_author_id => '00000000-0000-0000-0000-000000000e0a')),
  array['ee000000-0000-0000-0000-000000000003'], 'stories stay out of profile grids and feeds');
select is((select count(*)::int from public.discover_posts(p_following => true)), 1, 'and the Following feed');
select is((select author_handle || ':' || story_count || ':' || all_seen from public.story_tray()), 'sto_ana:2:false',
  'Ben''s tray shows Ana with two unseen stories');
select is((select array_agg(id::text) from public.author_stories('00000000-0000-0000-0000-000000000e0a')),
  array['ee000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000002'], 'oldest first');
select is((select jsonb_path_query_first(media, '$[0].tags[0].item.title') #>> '{}' from public.author_stories('00000000-0000-0000-0000-000000000e0a') limit 1),
  'Oak desk', 'with their item tags');
select is((select view_count from public.author_stories('00000000-0000-0000-0000-000000000e0a') limit 1), null,
  'viewers don''t see view counts');
select public.mark_story_seen('ee000000-0000-0000-0000-000000000001');
select public.mark_story_seen('ee000000-0000-0000-0000-000000000002');
select public.mark_story_seen('ee000000-0000-0000-0000-000000000003');
select is((select all_seen from public.story_tray()), true, 'seen stories turn the ring grey');
select throws_ok($$select public.add_to_highlight('ee000000-0000-0000-0000-000000000001', null, 'Mine')$$, 'P0002', 'post_not_found',
  'only the author highlights a story');
reset role;
select is((select count(*)::int from public.story_views), 2, 'regular posts aren''t counted as story views');

-- Cy doesn't follow Ana: no tray, but the story is still viewable by link
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000e0c","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.story_tray()), 0, 'the tray only has people you follow');
select is((select count(*)::int from public.author_stories('00000000-0000-0000-0000-000000000e0a')), 2,
  'a profile''s live stories are open to anyone who can see them');
reset role;

-- Ana's own view
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000e0a","role":"authenticated"}', true);
set local role authenticated;
select is((select author_handle || ':' || is_me || ':' || all_seen from public.story_tray()), 'sto_ana:true:true', 'Ana sees herself first');
select is((select view_count from public.author_stories('00000000-0000-0000-0000-000000000e0a') limit 1), 1, 'the author sees view counts');
select is((select array_agg(handle) from public.story_viewers('ee000000-0000-0000-0000-000000000001')), array['sto_ben'],
  'and who viewed');
create temp table hl (k text primary key, v uuid);
insert into hl values ('desk', public.add_to_highlight('ee000000-0000-0000-0000-000000000001', null, ' Desk '));
select throws_ok($$select public.add_to_highlight('ee000000-0000-0000-0000-000000000002', null, '  ')$$, '22023',
  'invalid_highlight_name', 'highlights need a name');
select is((select name || ':' || has_story from public.my_highlights('ee000000-0000-0000-0000-000000000001')), 'Desk:true',
  'my highlights show which hold a story');
reset role;

-- A day later
update public.posts set expires_at = now() - interval '1 minute', published_at = now() - interval '25 hours'
where kind = 'story';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000e0b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.story_tray()), 0, 'expired stories leave the tray');
select is((select count(*)::int from public.author_stories('00000000-0000-0000-0000-000000000e0a')), 0, 'and the profile');
select is(public.can_view_post('ee000000-0000-0000-0000-000000000002'), false, 'an expired story can''t be opened');
select is(public.can_view_post_media('ee000000-0000-0000-0000-000000000002/0.jpg'), false, 'nor its photo');
select is((select name || ':' || story_count from public.profile_highlights('00000000-0000-0000-0000-000000000e0a')), 'Desk:1',
  'highlights keep a story');
select is((select count(*)::int from public.highlight_story_rows((select v from hl))), 1, 'and play it');
select is(public.can_view_post_media('ee000000-0000-0000-0000-000000000001/0.jpg'), true, 'with its photo');
reset role;

-- Ana sees her own expired stories (archive) and can remove one from the highlight
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000e0a","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_view_post('ee000000-0000-0000-0000-000000000002'), true, 'authors keep their expired stories');
select public.remove_from_highlight((select v from hl), 'ee000000-0000-0000-0000-000000000001');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000e0b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.profile_highlights('00000000-0000-0000-0000-000000000e0a')), 0,
  'an empty highlight isn''t shown');
reset role;

-- Blocks hide highlights
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-000000000e0c', '00000000-0000-0000-0000-000000000e0a');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000e0a","role":"authenticated"}', true);
set local role authenticated;
select public.add_to_highlight('ee000000-0000-0000-0000-000000000002', (select v from hl));
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000e0c","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.profile_highlights('00000000-0000-0000-0000-000000000e0a')), 0, 'blocked people see no highlights');
reset role;

select * from finish();
rollback;
