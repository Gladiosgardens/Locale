-- Profile photos, caption edits, comment replies/likes, and activity.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000000c' || x)::uuid, x || 'p@example.com' from unnest(array['0a', '0b', '0c']) x;
update public.profile_private set adult_confirmed_at = now(), activity_seen_at = now() - interval '1 day'
where profile_id::text like '00000000-0000-0000-0000-000000000c%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-000000000c0a'::uuid, 'act_ana'), ('00000000-0000-0000-0000-000000000c0b'::uuid, 'act_ben'),
             ('00000000-0000-0000-0000-000000000c0c'::uuid, 'act_cy')) v(id, h)
where p.id = v.id;
insert into public.posts (id, author_id, caption, status, searchable) values
  ('cc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000c0a', 'old caption', 'published', true);
insert into public.post_media (post_id, storage_path, width, height, position)
values ('cc000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001/0.jpg', 10, 10, 0);
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

-- Profile photos
set local role service_role;
select throws_ok($$select public.set_avatar_path('00000000-0000-0000-0000-000000000c0a', '00000000-0000-0000-0000-000000000c0b/aaaaaaaa-0000-0000-0000-000000000000.jpg')$$,
  '22023', 'invalid_avatar', 'a photo must be in the person''s own folder');
select is(public.set_avatar_path('00000000-0000-0000-0000-000000000c0a', '00000000-0000-0000-0000-000000000c0a/aaaaaaaa-0000-0000-0000-000000000001.jpg'),
  null, 'setting the first photo has nothing to clean up');
select is(public.set_avatar_path('00000000-0000-0000-0000-000000000c0a', '00000000-0000-0000-0000-000000000c0a/aaaaaaaa-0000-0000-0000-000000000002.jpg'),
  '00000000-0000-0000-0000-000000000c0a/aaaaaaaa-0000-0000-0000-000000000001.jpg', 'replacing it returns the old one to delete');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000c0a","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$update public.profiles set avatar_path = null where id = auth.uid()$$, '42501', null,
  'people cannot set the photo path directly');
select throws_ok($$select public.set_avatar_path(auth.uid(), null)$$, '42501', null, 'or call the server function');
select lives_ok($$update public.profiles set display_name = 'Ana Act', bio = 'Desk setups' where id = auth.uid()$$,
  'people can edit their name and bio');

-- Captions
select lives_ok($$select public.update_post_caption('cc000000-0000-0000-0000-000000000001', '  new caption ')$$, 'the author edits the caption');
select is((select caption from public.posts where id = 'cc000000-0000-0000-0000-000000000001'), 'new caption', 'trimmed');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000c0b","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.update_post_caption('cc000000-0000-0000-0000-000000000001', 'hacked')$$, 'P0002', 'post_not_found',
  'nobody else can edit it');

-- Comments, replies, likes
select public.set_post_like('cc000000-0000-0000-0000-000000000001', true);
insert into ids values ('b1', public.add_comment('cc000000-0000-0000-0000-000000000001', 'Where is the lamp from?'));
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000c0c","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.add_comment('cc000000-0000-0000-0000-000000000001', 'x', 'cc000000-0000-0000-0000-0000000000ff')$$,
  'P0002', 'comment_not_found', 'replies need an existing comment on the post');
insert into ids values ('c1', public.add_comment('cc000000-0000-0000-0000-000000000001', 'It is tagged!', (select v from ids where k = 'b1')));
select throws_ok($$select public.add_comment('cc000000-0000-0000-0000-000000000001', 'nested', (select v from ids where k = 'c1'))$$,
  'P0002', 'comment_not_found', 'replies are one level deep');
select lives_ok($$select public.set_comment_like((select v from ids where k = 'b1'), true)$$, 'C likes B''s comment');
select is((select parent_id::text || '|' || like_count from public.list_comments('cc000000-0000-0000-0000-000000000001')
           where id = (select v from ids where k = 'c1')), (select v::text from ids where k = 'b1') || '|0', 'replies carry their parent');
select is((select like_count::text || '|' || i_liked from public.list_comments('cc000000-0000-0000-0000-000000000001')
           where id = (select v from ids where k = 'b1')), '1|true', 'comment likes are counted');
reset role;
select is((select count(*)::int from public.notifications where kind = 'reply' and recipient_id = '00000000-0000-0000-0000-000000000c0b'), 1,
  'a reply notifies the person replied to');

-- Activity for A (the post's author)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000c0a","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(kind || ':' || actor_handle order by kind, actor_handle) from public.my_activity()),
  array['comment:act_ben', 'comment:act_cy', 'like:act_ben'], 'A sees likes and comments on their post');
select is(public.my_activity_unread(), 3, 'all of it unread');
select public.mark_activity_seen();
select is(public.my_activity_unread(), 0, 'and none after looking');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000c0b","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(kind || ':' || actor_handle) from public.my_activity()), array['reply:act_cy'],
  'B sees the reply to their comment');
reset role;
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-000000000c0b', '00000000-0000-0000-0000-000000000c0c');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000c0b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.my_activity()), 0, 'blocked people disappear from activity');

select * from finish();
rollback;
