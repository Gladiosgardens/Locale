-- Groups: visibility, membership flows, moderation, group posts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

-- These tests cover the local features, which use interests retired in global mode.
update public.interests set active = true;

-- Fixtures. Owner O, member M, requester R, outsider N (all near Downtown 9q9k5),
-- far user F (Los Angeles), and a not-yet-onboarded user U nearby.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000001a', 'o@example.com'),
  ('00000000-0000-0000-0000-00000000001b', 'm@example.com'),
  ('00000000-0000-0000-0000-00000000001c', 'r@example.com'),
  ('00000000-0000-0000-0000-00000000001d', 'n@example.com'),
  ('00000000-0000-0000-0000-00000000001e', 'f@example.com'),
  ('00000000-0000-0000-0000-00000000001f', 'u@example.com');

insert into public.areas (geohash5, name, center_lat, center_lng)
select g, n, (public.geohash_center(g)).lat, (public.geohash_center(g)).lng
from (values ('9q9k5', 'Downtown'), ('9q9k7', 'Northside'), ('9q5ct', 'Los Angeles')) as v(g, n)
on conflict (geohash5) do nothing;

update public.profile_private pp set area_id = a.id, adult_confirmed_at = now()
from (values ('00000000-0000-0000-0000-00000000001a'::uuid, '9q9k5'),
             ('00000000-0000-0000-0000-00000000001b'::uuid, '9q9k5'),
             ('00000000-0000-0000-0000-00000000001c'::uuid, '9q9k7'),
             ('00000000-0000-0000-0000-00000000001d'::uuid, '9q9k7'),
             ('00000000-0000-0000-0000-00000000001e'::uuid, '9q5ct'),
             ('00000000-0000-0000-0000-00000000001f'::uuid, '9q9k5')) as v(uid, g)
join public.areas a on a.geohash5 = v.g
where pp.profile_id = v.uid;

update public.profiles set handle = h, display_name = initcap(h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-00000000001a'::uuid, 'olga'),
             ('00000000-0000-0000-0000-00000000001b'::uuid, 'mia'),
             ('00000000-0000-0000-0000-00000000001c'::uuid, 'raj'),
             ('00000000-0000-0000-0000-00000000001d'::uuid, 'nora'),
             ('00000000-0000-0000-0000-00000000001e'::uuid, 'finn')) as v(uid, h)
where id = v.uid;

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;

------------------------------------------------------------------------------
-- O creates groups
------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001a","role":"authenticated"}', true);
set local role authenticated;

select throws_ok($$insert into public.groups (name, interest_id, area_id, privacy, created_by)
  select 'Sneaky', 1, id, 'public', '00000000-0000-0000-0000-00000000001a' from public.areas limit 1$$,
  '42501', null, 'groups cannot be inserted directly');

insert into ids values ('dogs', public.create_group('  Downtown   dog walkers ', 'Morning loops', 1::smallint, 'public'));
insert into ids values ('kids', public.create_group('Toddler parents', null, 3::smallint, 'public'));
insert into ids values ('books', public.create_group('Quiet book club', null, 17::smallint, 'private'));

select is((select name from public.groups where id = (select v from ids where k = 'dogs')),
  'Downtown dog walkers', 'group names are tidied');
select is((select privacy from public.groups where id = (select v from ids where k = 'kids')),
  'private', 'kid-related groups are forced private');
select is((select my_role from public.list_groups(p_group_id => (select v from ids where k = 'dogs'))),
  'owner', 'the creator is the owner');
select throws_ok($$select public.create_group('Fourth', null, 1::smallint, 'public')$$, 'P0001',
  'group_rate_limited', 'at most 3 new groups per day');
select throws_ok($$select public.create_group('x', null, 1::smallint, 'public')$$, '22023',
  'invalid_group', 'names need at least 3 characters');
select throws_ok($$select public.leave_group((select v from ids where k = 'dogs'))$$, '22023',
  'owner_cannot_leave', 'the owner cannot leave');

------------------------------------------------------------------------------
-- Joining
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001b","role":"authenticated"}', true);
set local role authenticated;
select is(public.join_group((select v from ids where k = 'dogs')), 'active', 'public groups: join instantly');
select is(public.join_group((select v from ids where k = 'kids')), 'pending', 'private groups: join is a request');
select is(public.join_group((select v from ids where k = 'kids')), 'pending', 'asking twice changes nothing');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001c","role":"authenticated"}', true);
set local role authenticated;
select is(public.join_group((select v from ids where k = 'kids')), 'pending', 'R (neighbouring cell) requests too');
select is((select count(*)::int from public.group_members where group_id = (select v from ids where k = 'kids')), 1,
  'a requester sees only their own row');
select is((select member_count from public.list_groups(p_group_id => (select v from ids where k = 'kids'))), 1,
  'member counts are still available');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001e","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.groups), 0, 'F in LA cannot see Downtown groups');
select is((select count(*)::int from public.list_groups()), 0, 'nor list them');
select throws_ok($$select public.join_group((select v from ids where k = 'dogs'))$$, 'P0002',
  'group_not_found', 'nor join them by id');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001f","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.join_group((select v from ids where k = 'dogs'))$$, '22023',
  'not_onboarded', 'users who have not finished onboarding cannot join');

------------------------------------------------------------------------------
-- Moderation (as O)
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001a","role":"authenticated"}', true);
set local role authenticated;
select is((select pending_count from public.list_groups(p_group_id => (select v from ids where k = 'kids'))), 2,
  'the owner sees how many requests are waiting');
select is((select array_agg(handle order by handle) from public.group_roster((select v from ids where k = 'kids'))
           where status = 'pending'),
  array['mia', 'raj'], 'the owner sees who asked');
select lives_ok($$select public.respond_to_join_request((select v from ids where k = 'kids'),
  '00000000-0000-0000-0000-00000000001b', true)$$, 'approve M');
select lives_ok($$select public.respond_to_join_request((select v from ids where k = 'kids'),
  '00000000-0000-0000-0000-00000000001c', false)$$, 'decline R');
select throws_ok($$select public.respond_to_join_request((select v from ids where k = 'kids'),
  '00000000-0000-0000-0000-00000000001c', true)$$, 'P0002', 'request_not_found', 'a declined request is gone');
select lives_ok($$select public.set_group_role((select v from ids where k = 'kids'),
  '00000000-0000-0000-0000-00000000001b', 'moderator')$$, 'the owner promotes M to moderator');

------------------------------------------------------------------------------
-- Group posts (service role publishes, as the Edge Function would)
------------------------------------------------------------------------------
reset role;
insert into storage.objects (bucket_id, name)
select 'post-media', p || '/0.jpg'
from unnest(array['b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
                  'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000009']) as p;
set local role service_role;

select public.create_post_record('b0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000001b', 'Rainy day crafts', array[3]::smallint[],
  '[{"path":"b0000000-0000-0000-0000-000000000001/0.jpg","width":10,"height":10}]',
  '[{"media":0,"x":0.5,"y":0.5,"item":{"title":"Finger paint","url":"https://example.com/paint"}}]',
  true, (select v from ids where k = 'kids'));
select public.create_post_record('b0000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-00000000001a', 'Group walk Saturday', '{}',
  '[{"path":"b0000000-0000-0000-0000-000000000002/0.jpg","width":10,"height":10}]',
  '[]', true, (select v from ids where k = 'dogs'));
select public.create_post_record('b0000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-00000000001a', 'Ordinary nearby post', '{}',
  '[{"path":"b0000000-0000-0000-0000-000000000003/0.jpg","width":10,"height":10}]');

select throws_ok($$select public.create_post_record('b0000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-00000000001d', null, '{}',
  '[{"path":"b0000000-0000-0000-0000-000000000009/0.jpg","width":10,"height":10}]',
  '[]', true, (select v from ids where k = 'dogs'))$$, '42501', 'not_a_member',
  'non-members cannot post into a group');
select is((select searchable from public.posts where id = 'b0000000-0000-0000-0000-000000000002'), false,
  'group posts are never globally searchable');

-- As N: a nearby non-member
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001d","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.groups), 3, 'N sees all three nearby groups exist');
select is((select array_agg(id::text) from public.nearby_feed()),
  array['b0000000-0000-0000-0000-000000000003'], 'group posts stay out of the Nearby feed');
select is((select count(*)::int from public.discover_posts() where id::text like 'b0000000%'), 1,
  'and out of Everywhere');
select is((select count(*)::int from public.discover_posts('paint')), 0, 'and out of search');
select is((select array_agg(id::text) from public.nearby_feed(p_group_id => (select v from ids where k = 'dogs'))),
  array['b0000000-0000-0000-0000-000000000002'], 'N can read a public group''s feed');
select is((select count(*)::int from public.nearby_feed(p_group_id => (select v from ids where k = 'kids'))), 0,
  'N cannot read a private group''s feed');
select is((select count(*)::int from public.posts where id = 'b0000000-0000-0000-0000-000000000001'), 0,
  'nor its posts directly');
select is((select count(*)::int from public.items where title = 'Finger paint'), 0, 'nor its tagged items');
select is((select count(*)::int from storage.objects where name like 'b0000000-0000-0000-0000-000000000001/%'), 0,
  'nor its images');
select is((select count(*)::int from public.group_roster((select v from ids where k = 'dogs'))), 0,
  'non-members cannot list a group''s members, even a public one');
select throws_ok($$select public.respond_to_join_request((select v from ids where k = 'kids'),
  '00000000-0000-0000-0000-00000000001c', true)$$, '42501', 'not_a_moderator',
  'non-moderators cannot approve requests');

-- As M: moderator of the kids group, member of dogs
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.nearby_feed(p_group_id => (select v from ids where k = 'kids'))), 1,
  'members read the private group''s feed');
select is((select count(*)::int from storage.objects where name like 'b0000000-0000-0000-0000-000000000001/%'), 1,
  'and its images');
select is((select array_agg(handle order by handle) from public.group_roster((select v from ids where k = 'dogs'))),
  array['mia', 'olga'], 'members see the roster');
select is((select count(*)::int from public.posts where group_id is not null), 2,
  'members see group posts through the table too');

-- Moderation by M (moderator of kids group): ban N after N joins dogs? M is not a dogs moderator.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001d","role":"authenticated"}', true);
set local role authenticated;
select is(public.join_group((select v from ids where k = 'kids')), 'pending', 'N requests the kids group');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001b","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.respond_to_join_request((select v from ids where k = 'kids'),
  '00000000-0000-0000-0000-00000000001d', true)$$, 'moderator M approves N');
select lives_ok($$select public.remove_group_member((select v from ids where k = 'kids'),
  '00000000-0000-0000-0000-00000000001d')$$, 'moderator M removes N');
select throws_ok($$select public.remove_group_member((select v from ids where k = 'kids'),
  '00000000-0000-0000-0000-00000000001a')$$, '42501', 'cannot_remove', 'nobody can remove the owner');
select throws_ok($$select public.set_group_role((select v from ids where k = 'kids'),
  '00000000-0000-0000-0000-00000000001d', 'moderator')$$, '42501', 'not_owner',
  'only the owner changes roles');
select throws_ok($$select public.remove_group_member((select v from ids where k = 'dogs'),
  '00000000-0000-0000-0000-00000000001a')$$, '42501', 'not_a_moderator',
  'members cannot remove anyone');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001d","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.join_group((select v from ids where k = 'kids'))$$, '42501',
  'banned_from_group', 'a removed member cannot ask again');
select is((select count(*)::int from public.nearby_feed(p_group_id => (select v from ids where k = 'kids'))), 0,
  'and loses access to the posts');

-- M leaves the dogs group
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001b","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.leave_group((select v from ids where k = 'dogs'))$$, 'members can leave');
select is((select my_status from public.list_groups(p_group_id => (select v from ids where k = 'dogs'))), null,
  'and are no longer listed as members');
select is((select count(*)::int from public.list_groups(p_mine => true)), 1, '"My groups" shows only M''s remaining group');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select * from public.list_groups()$$, '42501', null, 'anon cannot list groups');

select * from finish();
rollback;
