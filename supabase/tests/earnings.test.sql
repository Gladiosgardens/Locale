-- Creator earnings: clicks, commission import, 70% share, balances, payouts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

update public.interests set active = true;
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000001' || x)::uuid, x || 'e@example.com' from unnest(array['0a', '0b', '0c']) x;
update public.profile_private set adult_confirmed_at = now() where profile_id::text like '00000000-0000-0000-0000-0000000001%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-00000000010a'::uuid, 'ern_ana'), ('00000000-0000-0000-0000-00000000010b'::uuid, 'ern_ben'),
             ('00000000-0000-0000-0000-00000000010c'::uuid, 'ern_cy')) v(id, h)
where p.id = v.id;
insert into storage.objects (bucket_id, name) values ('post-media', '10000000-0000-0000-0000-000000000001/0.jpg');
set local role service_role;
select public.create_post_record('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000010a',
  'Desk', '{}', '[{"path":"10000000-0000-0000-0000-000000000001/0.jpg","width":1,"height":1}]',
  '[{"media":0,"x":0.2,"y":0.2,"item":{"title":"Oak desk","url":"https://shop.example.com/desk"}},
    {"media":0,"x":0.6,"y":0.6,"item":{"title":"Lamp","url":"https://lamps.example.com/l","is_affiliate":true}},
    {"media":0,"x":0.8,"y":0.8,"item":{"title":"Rug"}}]');
reset role;
create temp table ids as
select it.title, it.id from public.items it join public.item_tags t on t.item_id = it.id
join public.post_media m on m.id = t.post_media_id where m.post_id = '10000000-0000-0000-0000-000000000001';
create temp table clicks (k text primary key, v uuid);
grant select on ids to authenticated, service_role;
grant all on clicks to authenticated, service_role;

-- Ben taps Shop on the desk (plain link) and the lamp (Ana's own affiliate link)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000010b","role":"authenticated"}', true);
set local role authenticated;
insert into clicks select 'desk', click_id from public.start_shop_click('10000000-0000-0000-0000-000000000001', (select id from ids where title = 'Oak desk'));
select is((select url || ':' || own_affiliate from public.start_shop_click('10000000-0000-0000-0000-000000000001', (select id from ids where title = 'Lamp'))),
  'https://lamps.example.com/l:true', 'a poster''s own affiliate link is returned untouched and flagged');
insert into clicks select 'lamp', id from public.affiliate_clicks where item_id = (select id from ids where title = 'Lamp');
select throws_ok($$select * from public.start_shop_click('10000000-0000-0000-0000-000000000001', (select id from ids where title = 'Rug'))$$,
  'P0002', 'item_not_found', 'items without a link have nothing to shop');
select throws_ok($$select * from public.start_shop_click(gen_random_uuid(), (select id from ids where title = 'Oak desk'))$$,
  'P0002', 'post_not_found', 'only posts you can see');
select throws_ok($$select * from public.import_commission('sovrn', 'x', null, 100, 1000, 'USD', 'pending', now())$$, '42501', null,
  'users can''t import commissions');
reset role;
-- Ana taps her own desk link
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000010a","role":"authenticated"}', true);
set local role authenticated;
insert into clicks select 'self', click_id from public.start_shop_click('10000000-0000-0000-0000-000000000001', (select id from ids where title = 'Oak desk'));
reset role;
select is((select array_agg(credit_poster order by created_at) from public.affiliate_clicks), array[true, false, false],
  'clicks credit the poster except own affiliate links and self-clicks');

-- The network reports sales
set local role service_role;
select is(public.import_commission('sovrn', 'T1', (select v::text from clicks where k = 'desk'), 1000, 10000, 'usd', 'pending', now()),
  'credited', 'a sale through Ben''s click credits Ana');
select is(public.import_commission('sovrn', 'T2', (select v::text from clicks where k = 'self'), 500, 5000, 'USD', 'pending', now()),
  'locale', 'Ana buying through her own post isn''t credited');
select is(public.import_commission('sovrn', 'T3', (select v::text from clicks where k = 'lamp'), 300, 3000, 'USD', 'pending', now()),
  'locale', 'own affiliate links aren''t credited by Locale');
select is(public.import_commission('sovrn', 'T4', 'not-a-uuid', 200, 2000, 'USD', 'pending', now()), 'locale',
  'unknown custom IDs belong to Locale');
select is(public.import_commission('sovrn', 'T1', (select v::text from clicks where k = 'desk'), 1000, 10000, 'USD', 'pending', now()),
  'unchanged', 're-importing the same sale changes nothing');
select throws_ok($$select public.import_commission('sovrn', 'T5', null, 1, 1, 'USD', 'approved', now())$$, '22023', 'bad_status',
  'statuses are normalized before import');
reset role;
select is((select creator_cents || '/' || creator_share_bps || '/' || currency from public.commissions where external_id = 'T1'),
  '700/7000/USD', 'the poster gets 70%');
select is((select count(*)::int from public.commissions), 4, 'every sale is recorded');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000010a","role":"authenticated"}', true);
set local role authenticated;
select is((select pending_cents || '/' || available_cents || '/' || paid_cents || '/' || share_percent || '/' || minimum_payout_cents
           from public.my_earnings_summary()), '700/0/0/70/2500', 'pending until the return window closes');
select is((select status || ':' || creator_cents || ':' || item_title from public.my_commissions()), 'pending:700:Oak desk',
  'Ana''s sales list');
select is((select sales || '/' || earned_cents from public.post_earnings('10000000-0000-0000-0000-000000000001')), '1/700',
  'post earnings');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000010b","role":"authenticated"}', true);
set local role authenticated;
select is((select available_cents + pending_cents from public.my_earnings_summary()), 0, 'Ben earned nothing');
select is((select count(*)::int from public.my_commissions()), 0, 'and sees no one else''s sales');
reset role;

-- Locked: becomes available; with a bigger sale it reaches the minimum
set local role service_role;
select public.import_commission('sovrn', 'T1', (select v::text from clicks where k = 'desk'), 1000, 10000, 'USD', 'locked', now());
select public.import_commission('sovrn', 'T6', (select v::text from clicks where k = 'desk'), 4000, 40000, 'USD', 'locked', now());
select is((select count(*)::int from public.payable_creators()), 0, 'no payout without a Stripe account');
select public.save_creator_account('00000000-0000-0000-0000-00000000010a', 'acct_123ABC', 'eg', true, false);
select is((select count(*)::int from public.payable_creators()), 0, 'nor before Stripe enables payouts');
select public.save_creator_account('00000000-0000-0000-0000-00000000010a', 'acct_123ABC', 'EG', true, true);
select is((select available_cents from public.payable_creators()), 3500, 'then $35 is payable (70% of $50)');

-- A payout fails, then succeeds
create temp table po as select * from public.begin_payout('00000000-0000-0000-0000-00000000010a');
select is((select amount_cents from po), 3500, 'the payout reserves the available balance');
select is((select available_cents from public.creator_balances('00000000-0000-0000-0000-00000000010a')), 0, 'leaving nothing available');
select is((select count(*)::int from public.begin_payout('00000000-0000-0000-0000-00000000010a')), 0, 'and no second payout');
select public.fail_payout((select payout_id from po), 'bank rejected');
select is((select available_cents from public.creator_balances('00000000-0000-0000-0000-00000000010a')), 3500, 'a failed transfer frees it again');
drop table po;
create temp table po as select * from public.begin_payout('00000000-0000-0000-0000-00000000010a');
select public.complete_payout((select payout_id from po), 'tr_1');
select is((select paid_cents || '/' || available_cents from public.creator_balances('00000000-0000-0000-0000-00000000010a')), '3500/0',
  'a completed payout counts as paid');
select is(public.import_commission('sovrn', 'T6', (select v::text from clicks where k = 'desk'), 0, 40000, 'USD', 'locked', now()),
  'unchanged', 'paid commissions can''t be rewritten');

-- A paid sale is returned: taken back from the next payout
select public.import_commission('sovrn', 'T6', (select v::text from clicks where k = 'desk'), 4000, 40000, 'USD', 'reversed', now());
select is((select available_cents from public.creator_balances('00000000-0000-0000-0000-00000000010a')), -2800,
  'a reversal after payout is owed back');
select public.import_commission('sovrn', 'T7', (select v::text from clicks where k = 'desk'), 10000, 100000, 'USD', 'locked', now());
select is((select available_cents from public.creator_balances('00000000-0000-0000-0000-00000000010a')), 4200,
  'and comes out of the next earnings ($70 - $28)');
drop table po;
create temp table po as select * from public.begin_payout('00000000-0000-0000-0000-00000000010a');
select is((select amount_cents from po), 4200, 'the next payout is net of the reversal');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000010a","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(status order by occurred_at, creator_cents) from public.my_commissions()),
  array['paid', 'reversed', 'processing'], 'sale statuses for the creator');
select throws_ok($$select public.save_creator_account('00000000-0000-0000-0000-00000000010a', 'acct_x', 'US', true, true)$$, '42501', null,
  'users can''t mark their own account ready');
reset role;

select * from finish();
rollback;
