-- Instagram import: tokens stay server-side; states are single-use; dates.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000050a', 'ig@example.com');
update public.profile_private set adult_confirmed_at = now() where profile_id = '00000000-0000-0000-0000-00000000050a';
update public.profiles set handle = 'ig_ana', display_name = 'Ana', onboarded_at = now() where id = '00000000-0000-0000-0000-00000000050a';
insert into storage.objects (bucket_id, name) values ('post-media', '50000000-0000-0000-0000-000000000001/0.jpg');

set local role service_role;
insert into public.instagram_connections (profile_id, ig_user_id, username, access_token, expires_at)
values ('00000000-0000-0000-0000-00000000050a', '178', 'ana.makes', 'SECRET-TOKEN', now() + interval '60 days');
insert into public.instagram_oauth_states (state, profile_id) values (repeat('a', 40), '00000000-0000-0000-0000-00000000050a');
select is(public.take_instagram_state(repeat('a', 40)), '00000000-0000-0000-0000-00000000050a'::uuid, 'a state identifies who is connecting');
select is(public.take_instagram_state(repeat('a', 40)), null, 'and works once');
select public.create_post_record('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000050a',
  'From Instagram', '{}', '[{"path":"50000000-0000-0000-0000-000000000001/0.jpg","width":1,"height":1}]');
select public.set_imported_post_date('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000050a', '2024-05-01T10:00:00Z');
insert into public.instagram_imports (profile_id, ig_media_id, post_id)
values ('00000000-0000-0000-0000-00000000050a', 'm1', '50000000-0000-0000-0000-000000000001');
reset role;
select is((select published_at from public.posts where id = '50000000-0000-0000-0000-000000000001'), '2024-05-01T10:00:00Z'::timestamptz,
  'imported posts keep their Instagram date');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050a","role":"authenticated"}', true);
set local role authenticated;
select is((select connected::text || ':' || username || ':' || imported from public.my_instagram()), 'true:ana.makes:1',
  'the app sees the username and count');
select throws_ok($$select access_token from public.instagram_connections$$, '42501', null, 'never the token');
select throws_ok($$select public.take_instagram_state('x')$$, '42501', null, 'states are server-only');
select public.disconnect_instagram();
select is((select connected from public.my_instagram()), false, 'disconnecting removes the token');
reset role;
select is((select count(*)::int from public.instagram_connections), 0, 'gone from the table too');

select * from finish();
rollback;
