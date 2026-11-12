-- Delete account: the summary, the files to remove, and what survives.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000005d1', 'del@example.com'),
                                          ('00000000-0000-0000-0000-0000000005d2', 'keep@example.com');
update public.profile_private set adult_confirmed_at = now() where profile_id in ('00000000-0000-0000-0000-0000000005d1', '00000000-0000-0000-0000-0000000005d2');
update public.profiles set handle = 'del_dana', display_name = 'Dana', onboarded_at = now() where id = '00000000-0000-0000-0000-0000000005d1';
update public.profiles set handle = 'keep_kai', display_name = 'Kai', onboarded_at = now() where id = '00000000-0000-0000-0000-0000000005d2';
insert into storage.objects (bucket_id, name) values ('post-media', '5d000000-0000-0000-0000-000000000001/0.jpg');

set local role service_role;
select public.create_post_record('5d000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000005d1',
  'Desk', '{}', '[{"path":"5d000000-0000-0000-0000-000000000001/0.jpg","width":1,"height":1}]');
reset role;
insert into public.payouts (id, profile_id, stripe_account_id, amount_cents, status, stripe_transfer_id)
values ('5d000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000005d1', 'acct_1Dana', 3000, 'paid', 'tr_1');
insert into public.commissions (network, external_id, poster_id, commission_cents, creator_share_bps, creator_cents, status, occurred_at)
values ('sovrn', 'o-1', '00000000-0000-0000-0000-0000000005d1', 1000, 7000, 700, 'pending', now()),
       ('sovrn', 'o-2', '00000000-0000-0000-0000-0000000005d1', 500, 7000, 350, 'locked', now());

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005d1","role":"authenticated"}', true);
set local role authenticated;
select is((select handle || ':' || post_count || ':' || unpaid_cents || ':' || payout_in_progress from public.account_deletion_summary()),
  'del_dana:1:1050:false', 'the summary shows posts and unpaid earnings');
select throws_ok($$select * from public.account_files('00000000-0000-0000-0000-0000000005d1')$$, '42501', null,
  'the file list is server-only');
reset role;

set local role service_role;
select is((select array_agg(path) from public.account_files('00000000-0000-0000-0000-0000000005d1') where bucket = 'post-media'),
  array['5d000000-0000-0000-0000-000000000001/0.jpg'], 'it lists the photos to remove');
reset role;
update public.payouts set status = 'processing' where id = '5d000000-0000-0000-0000-0000000000a1';
set local role service_role;
select throws_ok($$select * from public.account_files('00000000-0000-0000-0000-0000000005d1')$$, 'P0001', 'payout_in_progress',
  'not while a payout is being sent');
reset role;
update public.payouts set status = 'paid' where id = '5d000000-0000-0000-0000-0000000000a1';

delete from auth.users where id = '00000000-0000-0000-0000-0000000005d1';
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000005d1'), 0, 'the profile is gone');
select is((select count(*)::int from public.posts where author_id = '00000000-0000-0000-0000-0000000005d1'), 0, 'and their posts');
select is((select stripe_transfer_id || ':' || coalesce(profile_id::text, 'none') from public.payouts where id = '5d000000-0000-0000-0000-0000000000a1'),
  'tr_1:none', 'payout records stay, without the person');
select is((select count(*)::int from public.commissions where external_id in ('o-1', 'o-2') and poster_id is null), 2,
  'commission records stay, without the person');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000005d2'), 1, 'other accounts are untouched');

select * from finish();
rollback;
