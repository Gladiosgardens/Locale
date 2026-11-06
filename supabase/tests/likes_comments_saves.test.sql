-- Likes, comments, saves and comment notifications.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- A posts; B and C view; D is blocked by A.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000009' || x)::uuid, x || '9@example.com' from unnest(array['0a', '0b', '0c', '0d']) x;
update public.profile_private set adult_confirmed_at = now() where profile_id::text like '00000000-0000-0000-0000-0000000009%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-00000000090a'::uuid, 'ava'), ('00000000-0000-0000-0000-00000000090b'::uuid, 'bob'),
             ('00000000-0000-0000-0000-00000000090c'::uuid, 'cyd'), ('00000000-0000-0000-0000-00000000090d'::uuid, 'dee')) v(id, h)
where p.id = v.id;
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-00000000090a', '00000000-0000-0000-0000-00000000090d');

insert into public.posts (id, author_id, caption, status, searchable, removed_at) values
  ('9c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000090a', 'desk', 'published', true, null),
  ('9c000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000090a', 'old', 'removed', true, now());
insert into public.post_media (id, post_id, storage_path, width, height, position)
values ('9d000000-0000-0000-0000-000000000001', '9c000000-0000-0000-0000-000000000001',
        '9c000000-0000-0000-0000-000000000001/0.jpg', 100, 100, 0);
insert into public.items (id, created_by, title, brand) values
  ('9e000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000090a', 'Keyboard', 'Keychron'),
  ('9e000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000090a', 'Elsewhere', null);
insert into public.item_tags (post_media_id, item_id, x, y)
values ('9d000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000001', 0.5, 0.5);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

------------------------------------------------------------------------------
-- As B
------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000090b","role":"authenticated"}', true);
set local role authenticated;

select throws_ok('select * from public.post_likes', '42501', null, 'likes are not readable directly');
select throws_ok('select * from public.comments', '42501', null, 'nor are comments');
select throws_ok($$insert into public.saved_items (profile_id, item_id, post_id) values
  ('00000000-0000-0000-0000-00000000090b', '9e000000-0000-0000-0000-000000000001', '9c000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'saved items are written only through functions');

-- Likes
select lives_ok($$select public.set_post_like('9c000000-0000-0000-0000-000000000001', true)$$, 'B likes the post');
select lives_ok($$select public.set_post_like('9c000000-0000-0000-0000-000000000001', true)$$, 'liking twice is harmless');
select throws_ok($$select public.set_post_like('9c000000-0000-0000-0000-000000000002', true)$$, 'P0002', 'post_not_found',
  'removed posts cannot be liked');
select is((select like_count::text || '|' || i_liked from public.discover_posts(p_post_id => '9c000000-0000-0000-0000-000000000001')),
  '1|true', 'the feed shows the count and that I liked it');

-- Comments
select throws_ok($$select public.add_comment('9c000000-0000-0000-0000-000000000001', '   ')$$, '22023', 'invalid_comment',
  'empty comments are refused');
select throws_ok($$select public.add_comment('9c000000-0000-0000-0000-000000000001', repeat('x', 1001))$$, '22023',
  'invalid_comment', 'over 1,000 characters is refused');
insert into ids values ('b1', public.add_comment('9c000000-0000-0000-0000-000000000001', '  Where is the lamp from?  '));
select is((select body from public.list_comments('9c000000-0000-0000-0000-000000000001') where id = (select v from ids where k = 'b1')),
  'Where is the lamp from?', 'comments are trimmed');
select throws_ok($$select public.add_comment('9c000000-0000-0000-0000-000000000002', 'hi')$$, 'P0002', 'post_not_found',
  'nobody can comment on a removed post');

-- Saves
select lives_ok($$select public.set_post_saved('9c000000-0000-0000-0000-000000000001', true)$$, 'B saves the post');
select is((select array_agg(caption) from public.discover_posts(p_saved => true)), array['desk'], 'Saved lists it');
select lives_ok($$select public.set_item_saved('9e000000-0000-0000-0000-000000000001', '9c000000-0000-0000-0000-000000000001', true)$$,
  'B saves the keyboard');
select throws_ok($$select public.set_item_saved('9e000000-0000-0000-0000-000000000002', '9c000000-0000-0000-0000-000000000001', true)$$,
  'P0002', 'item_not_found', 'only items tagged on that post can be saved from it');
select is((select title || '|' || brand || '|' || photo_path from public.my_saved_items()),
  'Keyboard|Keychron|9c000000-0000-0000-0000-000000000001/0.jpg', 'the wishlist has the item and its photo');
select is((select count(*)::int from public.saved_items), 1, 'B can read their own saved items');

------------------------------------------------------------------------------
-- As C
------------------------------------------------------------------------------
reset role;
-- Everything in a test shares one now(); give comments distinct times.
update public.comments set created_at = now() - interval '1 hour' where id = (select v from ids where k = 'b1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000090c","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.saved_items), 0, 'C cannot see B''s saved items');
select is((select count(*)::int from public.discover_posts(p_saved => true)), 0, 'nor B''s saved posts');
select is((select i_liked::text || '|' || i_saved || '|' || like_count from public.discover_posts(p_post_id => '9c000000-0000-0000-0000-000000000001')),
  'false|false|1', 'C sees the like count but not as theirs');
insert into ids values ('c1', public.add_comment('9c000000-0000-0000-0000-000000000001', 'Love this'));
select is((select array_agg(body order by created_at, id) from public.list_comments('9c000000-0000-0000-0000-000000000001')),
  array['Where is the lamp from?', 'Love this'], 'comments are listed oldest first');
select is((select array_agg(can_delete order by created_at, id) from public.list_comments('9c000000-0000-0000-0000-000000000001')),
  array[false, true], 'people can delete only their own comments');
select public.delete_comment((select v from ids where k = 'b1'));
select is((select count(*)::int from public.list_comments('9c000000-0000-0000-0000-000000000001')), 2,
  'deleting someone else''s comment does nothing');

------------------------------------------------------------------------------
-- As D (blocked by A)
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000090d","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.add_comment('9c000000-0000-0000-0000-000000000001', 'hey')$$, 'P0002', 'post_not_found',
  'blocked people cannot comment');
select is((select count(*)::int from public.list_comments('9c000000-0000-0000-0000-000000000001')), 0,
  'or read the comments');

------------------------------------------------------------------------------
-- As A (author)
------------------------------------------------------------------------------
reset role;
select is((select count(*)::int from public.notifications where kind = 'comment' and recipient_id = '00000000-0000-0000-0000-00000000090a'), 1,
  'two comments while unsent make one notification');
select is((select actor_id::text from public.notifications where kind = 'comment'), '00000000-0000-0000-0000-00000000090c',
  'naming the latest commenter');
set local role service_role;
select is((select post_id::text from public.claim_notifications(10) where kind = 'comment'), '9c000000-0000-0000-0000-000000000001',
  'the sender gets the post to open');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000090a","role":"authenticated"}', true);
set local role authenticated;
select is((select comment_count from public.discover_posts(p_post_id => '9c000000-0000-0000-0000-000000000001')), 2,
  'the post shows two comments');
insert into ids values ('a1', public.add_comment('9c000000-0000-0000-0000-000000000001', 'Thanks!'));
reset role;
update public.comments set created_at = now() + interval '1 minute' where id = (select v from ids where k = 'a1');
select is((select count(*)::int from public.notifications where kind = 'comment' and actor_id = '00000000-0000-0000-0000-00000000090a'), 0,
  'commenting on your own post notifies nobody');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000090a","role":"authenticated"}', true);
set local role authenticated;
select public.delete_comment((select v from ids where k = 'c1'));
select is((select array_agg(body order by created_at, id) from public.list_comments('9c000000-0000-0000-0000-000000000001')),
  array['Where is the lamp from?', 'Thanks!'], 'the post''s author can delete any comment on it');

-- Reporting
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000090c","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.report_content('comment', (select v from ids where k = 'c1'), 'spam')$$, 'P0002',
  'report_target_not_found', 'you cannot report your own comment');
select lives_ok($$select public.report_content('comment', (select v from ids where k = 'b1'), 'child_safety')$$,
  'C reports B''s comment for child safety');
select is((select count(*)::int from public.list_comments('9c000000-0000-0000-0000-000000000001')
           where id = (select v from ids where k = 'b1')), 0, 'it is hidden at once');
reset role;
select lives_ok($$select public.resolve_report('comment', (select v from ids where k = 'b1'), 'dismiss')$$, 'a reviewer dismisses it');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000090c","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.list_comments('9c000000-0000-0000-0000-000000000001')
           where id = (select v from ids where k = 'b1')), 1, 'and it is back');

-- Removing the post hides saved items that came from it.
reset role;
update public.posts set status = 'removed', removed_at = now() where id = '9c000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000090b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.my_saved_items()), 0, 'saved items from a removed post disappear');

select * from finish();
rollback;
