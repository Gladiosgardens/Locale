-- Earnings notifications: first sale, later sales adding up, payouts, weekly digest.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000002' || x)::uuid, x || 'n@example.com' from unnest(array['0a', '0b']) x;
update public.profile_private set adult_confirmed_at = now() where profile_id::text like '00000000-0000-0000-0000-0000000002%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-00000000020a'::uuid, 'not_ana'), ('00000000-0000-0000-0000-00000000020b'::uuid, 'not_ben')) v(id, h)
where p.id = v.id;
insert into storage.objects (bucket_id, name) values ('post-media', '20000000-0000-0000-0000-000000000001/0.jpg');
set local role service_role;
select public.create_post_record('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000020a',
  'Desk', '{}', '[{"path":"20000000-0000-0000-0000-000000000001/0.jpg","width":1,"height":1}]',
  '[{"media":0,"x":0.2,"y":0.2,"item":{"title":"Oak desk","url":"https://shop.example.com/desk"}}]');
reset role;
create temp table c (v uuid);
create temp table i as select t.item_id as v from public.item_tags t join public.post_media m on m.id = t.post_media_id
  where m.post_id = '20000000-0000-0000-0000-000000000001';
grant all on c, i to authenticated, service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000020b","role":"authenticated"}', true);
set local role authenticated;
insert into c select click_id from public.start_shop_click('20000000-0000-0000-0000-000000000001',
  (select v from i));
reset role;
delete from public.notifications;

set local role service_role;
select public.import_commission('net', 'A1', (select v::text from c), 1000, 10000, 'USD', 'pending', now());
reset role;
select is((select kind || ':' || (data ->> 'cents') || ':' || (data ->> 'item') from public.notifications), 'first_sale:700:Oak desk',
  'the first sale gets a celebration');
set local role service_role;
select public.import_commission('net', 'A2', (select v::text from c), 2000, 20000, 'USD', 'pending', now());
select public.import_commission('net', 'A3', (select v::text from c), 1000, 10000, 'USD', 'pending', now());
select public.import_commission('net', 'A3', (select v::text from c), 1000, 10000, 'USD', 'locked', now());
reset role;
select is((select (data ->> 'cents') || '/' || (data ->> 'count') from public.notifications where kind = 'sale'), '2100/2',
  'later sales on a post add up into one push');
select is((select count(*)::int from public.notifications where kind = 'sale'), 1, 'and an update doesn''t push again');

-- Delivery reads the data
set local role service_role;
select is((select data ->> 'cents' from public.claim_notifications(10) where kind = 'sale'), '2100', 'delivery gets the amounts');
reset role;
update public.notifications set sent_at = now();

-- Weekly digest
set local role service_role;
select is(public.weekly_earnings_digest(), 1, 'one weekly summary');
reset role;
select is((select (data ->> 'cents') || '/' || (data ->> 'count') from public.notifications where kind = 'weekly_earnings'),
  '2800/3', 'adding up the week''s sales');

-- Payout sent
set local role service_role;
select public.save_creator_account('00000000-0000-0000-0000-00000000020a', 'acct_9', 'US', true, true);
select public.import_commission('net', 'A4', (select v::text from c), 4000, 40000, 'USD', 'locked', now());
create temp table po as select * from public.begin_payout('00000000-0000-0000-0000-00000000020a');
select public.complete_payout((select payout_id from po), 'tr_9');
reset role;
select is((select data ->> 'cents' from public.notifications where kind = 'payout_sent'), '3500', 'a push when the payout is sent');

-- Opting out
update public.notifications set sent_at = now();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000020a","role":"authenticated"}', true);
set local role authenticated;
select public.set_notification_preferences(p_earnings => false);
reset role;
set local role service_role;
select public.import_commission('net', 'A5', (select v::text from c), 1000, 10000, 'USD', 'pending', now());
reset role;
select is((select count(*)::int from public.notifications where sent_at is null), 0, 'no pushes after turning them off');
select is((select count(*)::int from public.commissions where poster_id = '00000000-0000-0000-0000-00000000020a'), 5,
  'but the sale still counts');

select * from finish();
rollback;
