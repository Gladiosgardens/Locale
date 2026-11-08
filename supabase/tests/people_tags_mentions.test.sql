-- People tags, @mentions, #hashtags and collections.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

update public.interests set active = true;
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000000d' || x)::uuid, x || 'm@example.com' from unnest(array['0a', '0b', '0c', '0d']) x;
update public.profile_private set adult_confirmed_at = now() where profile_id::text like '00000000-0000-0000-0000-000000000d%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-000000000d0a'::uuid, 'men_ana'), ('00000000-0000-0000-0000-000000000d0b'::uuid, 'men_ben'),
             ('00000000-0000-0000-0000-000000000d0c'::uuid, 'men_cy'), ('00000000-0000-0000-0000-000000000d0d'::uuid, 'men_dee')) v(id, h)
where p.id = v.id;
-- Dee blocks Ana.
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-000000000d0d', '00000000-0000-0000-0000-000000000d0a');
-- Cy turns mention notifications off.
update public.profile_private set notify_mentions = false where profile_id = '00000000-0000-0000-0000-000000000d0c';
delete from public.notifications;

-- Parsing
select is(public.extract_mentions('hi @Men_Ben and @men_cy, mail a@men_ben.com @me @men_ben'), array['men_ben', 'men_cy'],
  'mentions: lowercased, distinct, not inside emails, 3+ characters');
select is(public.extract_hashtags('#OOTD #ootd #summer_24 #2024 and#nope #café x#y #a'), array['a', 'café', 'ootd', 'summer_24'],
  'hashtags: lowercased, distinct, any letters, not all digits, not glued to a word');

-- A caption with mentions and hashtags
insert into public.posts (id, author_id, caption, status, searchable) values
  ('dd000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000d0a',
   'Desk day with @men_ben @men_cy @men_dee @men_ana #DeskSetup #wfh', 'published', true);
insert into public.post_media (post_id, storage_path, width, height, position) values
  ('dd000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001/0.jpg', 10, 10, 0),
  ('dd000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001/1.jpg', 10, 10, 1);

select is((select array_agg(tag order by tag) from public.post_hashtags where post_id = 'dd000000-0000-0000-0000-000000000001'),
  array['desksetup', 'wfh'], 'hashtags are stored');
select is((select array_agg(pr.handle order by pr.handle) from public.post_mentions m join public.profiles pr on pr.id = m.profile_id
           where m.post_id = 'dd000000-0000-0000-0000-000000000001'),
  array['men_ben', 'men_cy'], 'mentions skip yourself and people with a block');
select is((select array_agg(recipient_id::text) from public.notifications where kind = 'mention'),
  array['00000000-0000-0000-0000-000000000d0b'], 'only Ben is notified (Cy turned mentions off)');

-- Editing the caption notifies only newly mentioned people
delete from public.notifications;
update public.posts set caption = 'Desk day with @men_ben #desksetup #ergonomic' where id = 'dd000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.notifications), 0, 'no one is notified twice');
select is((select array_agg(tag order by tag) from public.post_hashtags where post_id = 'dd000000-0000-0000-0000-000000000001'),
  array['desksetup', 'ergonomic'], 'hashtags follow the edit');
select is((select count(*)::int from public.post_mentions where post_id = 'dd000000-0000-0000-0000-000000000001'), 1,
  'removed mentions are dropped');

-- Hashtag feed
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000d0b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.discover_posts(p_hashtag => '#DeskSetup')), 1, 'the hashtag feed finds the post');
select is((select count(*)::int from public.discover_posts(p_hashtag => 'wfh')), 0, 'and not for a removed tag');
reset role;

-- People tags
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000d0b","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.set_people_tags('dd000000-0000-0000-0000-000000000001', '[]')$$, 'P0002', 'post_not_found',
  'only the author tags people');
reset role;
delete from public.notifications;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000d0a","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.set_people_tags('dd000000-0000-0000-0000-000000000001',
  '[{"position":0,"profile_id":"00000000-0000-0000-0000-000000000d0d","x":0.5,"y":0.5}]')$$, 'P0002', 'person_not_found',
  'people with a block cannot be tagged');
select throws_ok($$select public.set_people_tags('dd000000-0000-0000-0000-000000000001',
  '[{"position":5,"profile_id":"00000000-0000-0000-0000-000000000d0b","x":0.5,"y":0.5}]')$$, '22023', 'invalid_people_tag',
  'tags must be on one of the post''s photos');
select throws_ok($$select public.set_people_tags('dd000000-0000-0000-0000-000000000001',
  '[{"position":0,"profile_id":"00000000-0000-0000-0000-000000000d0b","x":1.5,"y":0.5}]')$$, '23514', null,
  'and inside the photo');
select throws_ok($$select public.set_people_tags('dd000000-0000-0000-0000-000000000001',
  '[{"position":0,"profile_id":"nope","x":0.5,"y":0.5}]')$$, '22023', 'invalid_people_tag', 'bad ids are rejected');
select lives_ok($$select public.set_people_tags('dd000000-0000-0000-0000-000000000001',
  '[{"position":0,"profile_id":"00000000-0000-0000-0000-000000000d0b","x":0.2,"y":0.3},
    {"position":1,"profile_id":"00000000-0000-0000-0000-000000000d0c","x":0.6,"y":0.7}]')$$, 'the author tags Ben and Cy');
select is((select jsonb_path_query_array(media, '$[*].people[*].handle') from public.discover_posts(p_post_id => 'dd000000-0000-0000-0000-000000000001')),
  '["men_ben", "men_cy"]'::jsonb, 'tags are in the media JSON');
select is((select count(*)::int from public.people_tags), 2, 'people tags on visible photos can be read');
select throws_ok($$delete from public.people_tags$$, '42501', null, 'but not changed directly');
reset role;
select is((select array_agg(recipient_id::text) from public.notifications where kind = 'tag'),
  array['00000000-0000-0000-0000-000000000d0b'], 'Ben is told he was tagged (Cy turned it off)');
delete from public.notifications;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000d0a","role":"authenticated"}', true);
set local role authenticated;
select public.set_people_tags('dd000000-0000-0000-0000-000000000001',
  '[{"position":0,"profile_id":"00000000-0000-0000-0000-000000000d0b","x":0.25,"y":0.3}]');
reset role;
select is((select count(*)::int from public.notifications), 0, 'moving a tag doesn''t notify again');
select is((select count(*)::int from public.people_tags), 1, 'and replaces the old set');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000d0b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.discover_posts(p_tagged_id => '00000000-0000-0000-0000-000000000d0b')), 1,
  'Ben''s Tagged tab shows the post');
select is((select array_agg(kind || ':' || actor_handle order by kind) from public.my_activity()),
  array['mention:men_ana', 'tag:men_ana'], 'Ben''s activity shows the mention and the tag');
select public.remove_my_people_tag('dd000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.discover_posts(p_tagged_id => '00000000-0000-0000-0000-000000000d0b')), 0,
  'Ben can take himself off it');
reset role;

-- Comment mentions
delete from public.notifications;
update public.profile_private set notify_mentions = true where profile_id = '00000000-0000-0000-0000-000000000d0c';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000d0b","role":"authenticated"}', true);
set local role authenticated;
select public.add_comment('dd000000-0000-0000-0000-000000000001', '@men_cy look at this, @men_ana where from?');
reset role;
select is((select array_agg(kind || ':' || recipient_id::text order by kind) from public.notifications),
  array['comment:00000000-0000-0000-0000-000000000d0a', 'comment_mention:00000000-0000-0000-0000-000000000d0c'],
  'the author gets one comment notification, Cy a mention');

-- Collections
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000d0c","role":"authenticated"}', true);
set local role authenticated;
create temp table cids (k text primary key, v uuid);
insert into cids values ('desk', public.create_collection(' Desk ideas '));
select throws_ok($$select public.create_collection('desk IDEAS')$$, '23505', 'collection_exists', 'names are unique per person');
select throws_ok($$select public.create_collection('   ')$$, '22023', 'invalid_collection_name', 'and not blank');
select lives_ok($$select public.set_in_collection((select v from cids where k = 'desk'), 'dd000000-0000-0000-0000-000000000001', true)$$,
  'adding to a collection');
select is((select i_saved from public.discover_posts(p_post_id => 'dd000000-0000-0000-0000-000000000001')), true, 'also saves the post');
select is((select name || '|' || post_count from public.my_collections()), 'Desk ideas|1', 'collections list with counts');
select is(public.post_collection_ids('dd000000-0000-0000-0000-000000000001'), array[(select v from cids where k = 'desk')],
  'which collections hold a post');
select is((select count(*)::int from public.discover_posts(p_collection_id => (select v from cids where k = 'desk'))), 1,
  'the collection feed');
select public.set_post_saved('dd000000-0000-0000-0000-000000000001', false);
select is((select post_count from public.my_collections()), 0, 'unsaving takes it out of collections');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000d0b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.discover_posts(p_collection_id => (select v from cids where k = 'desk'))), 0,
  'other people can''t read someone''s collection');
select throws_ok($$select public.set_in_collection((select v from cids where k = 'desk'), 'dd000000-0000-0000-0000-000000000001', true)$$,
  'P0002', 'collection_not_found', 'or add to it');
reset role;

select * from finish();
rollback;
