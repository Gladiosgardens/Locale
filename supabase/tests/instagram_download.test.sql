-- Import from an Instagram download: dates, no mentions, once per post.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000006a1', 'dl@example.com'),
                                          ('00000000-0000-0000-0000-0000000006a2', 'sam@example.com');
update public.profile_private set adult_confirmed_at = now() where profile_id in ('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-0000000006a2');
update public.profiles set handle = 'dl_rania', display_name = 'Rania', onboarded_at = now() where id = '00000000-0000-0000-0000-0000000006a1';
update public.profiles set handle = 'sam', display_name = 'Sam', onboarded_at = now() where id = '00000000-0000-0000-0000-0000000006a2';
insert into storage.objects (bucket_id, name) values ('post-media', '6a000000-0000-0000-0000-000000000001/0.jpg'),
                                                      ('post-media', '6a000000-0000-0000-0000-000000000002/0.jpg');

set local role service_role;
select public.create_imported_post('6a000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a1',
  'Brunch with @sam #weekend', '[{"path":"6a000000-0000-0000-0000-000000000001/0.jpg","width":1,"height":1}]',
  'ig:1684000000:abc', '2023-05-13T17:46:40Z');
reset role;

select is((select published_at from public.posts where id = '6a000000-0000-0000-0000-000000000001'), '2023-05-13T17:46:40Z'::timestamptz,
  'the post keeps its Instagram date');
select is((select count(*)::int from public.post_mentions where post_id = '6a000000-0000-0000-0000-000000000001'), 0,
  'an @name from Instagram is not linked to a Locale account');
select is((select count(*)::int from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000006a2'), 0,
  'and nobody is notified');
select is((select array_agg(tag) from public.post_hashtags where post_id = '6a000000-0000-0000-0000-000000000001'), array['weekend'],
  'hashtags still work');

set local role service_role;
select throws_ok($$select public.create_imported_post('6a000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000006a1',
  null, '[{"path":"6a000000-0000-0000-0000-000000000002/0.jpg","width":1,"height":1}]', 'ig:1684000000:abc', now())$$,
  'P0001', 'already_imported', 'each Instagram post is imported once');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a1","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(k) from public.my_imported_keys(array['ig:1684000000:abc', 'ig:1:zzz']) k), array['ig:1684000000:abc'],
  'the app learns which posts are already imported');
select throws_ok($$select public.create_imported_post('6a000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000006a1',
  null, '[]', 'ig:2:x', now())$$, '42501', null, 'publishing imports is server-only');
reset role;

delete from public.posts where id = '6a000000-0000-0000-0000-000000000001';
set local role authenticated;
select is((select count(*)::int from public.my_imported_keys(array['ig:1684000000:abc'])), 0,
  'deleting the post lets it be imported again');
reset role;

select * from finish();
rollback;
