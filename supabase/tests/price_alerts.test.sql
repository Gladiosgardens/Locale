-- Price alerts: baseline, drops of 10%+, restocks, opting out, failures.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000004' || x)::uuid, x || 'p@example.com' from unnest(array['0a', '0b', '0c']) x;
update public.profile_private set adult_confirmed_at = now() where profile_id::text like '00000000-0000-0000-0000-0000000004%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-00000000040a'::uuid, 'pr_ana'), ('00000000-0000-0000-0000-00000000040b'::uuid, 'pr_ben'),
             ('00000000-0000-0000-0000-00000000040c'::uuid, 'pr_cy')) v(id, h)
where p.id = v.id;
insert into storage.objects (bucket_id, name) values ('post-media', '40000000-0000-0000-0000-000000000001/0.jpg');
set local role service_role;
select public.create_post_record('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000040a',
  'Desk', '{}', '[{"path":"40000000-0000-0000-0000-000000000001/0.jpg","width":1,"height":1}]',
  '[{"media":0,"x":0.2,"y":0.2,"item":{"title":"Oak desk","url":"https://shop.example.com/desk"}},
    {"media":0,"x":0.6,"y":0.6,"item":{"title":"Rug"}}]');
reset role;
create temp table i as select it.id, it.title from public.items it join public.item_tags t on t.item_id = it.id
  join public.post_media m on m.id = t.post_media_id where m.post_id = '40000000-0000-0000-0000-000000000001';
grant all on i to authenticated, service_role;
-- Ben and Cy save the desk; Cy turns price alerts off.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040b","role":"authenticated"}', true);
set local role authenticated;
select public.set_item_saved((select id from i where title = 'Oak desk'), '40000000-0000-0000-0000-000000000001', true);
select public.set_item_saved((select id from i where title = 'Rug'), '40000000-0000-0000-0000-000000000001', true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040c","role":"authenticated"}', true);
set local role authenticated;
select public.set_item_saved((select id from i where title = 'Oak desk'), '40000000-0000-0000-0000-000000000001', true);
select public.set_notification_preferences(p_price_alerts => false);
reset role;
delete from public.notifications;

set local role service_role;
select is((select array_agg(url) from public.items_to_check()), array['https://shop.example.com/desk'],
  'only saved items with a link are checked');
select is(public.record_price((select id from i where title = 'Oak desk'), 20000, 'usd', true), 'same', 'the first read is the baseline');
select is((select count(*)::int from public.items_to_check()), 0, 'and isn''t checked again the same day');
select is(public.record_price((select id from i where title = 'Oak desk'), 18500, 'USD', true), 'same', 'a 7.5% drop doesn''t alert');
select is(public.record_price((select id from i where title = 'Oak desk'), 16000, 'USD', true), 'drop', 'a 13.5% drop does');
reset role;
select is((select recipient_id::text || ':' || (data ->> 'old_cents') || '>' || (data ->> 'new_cents') from public.notifications where kind = 'price_drop'),
  '00000000-0000-0000-0000-00000000040b:18500>16000', 'Ben is told (Cy turned alerts off)');
set local role service_role;
select is(public.record_price((select id from i where title = 'Oak desk'), 16000, 'USD', false), 'same', 'selling out doesn''t alert');
select is(public.record_price((select id from i where title = 'Oak desk'), 16000, 'USD', true), 'restock', 'coming back does');
select public.record_price_failure((select id from i where title = 'Oak desk'));
reset role;
select is((select failures from public.item_prices), 1, 'failed reads are counted');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040b","role":"authenticated"}', true);
set local role authenticated;
select is((select current_price_cents || '/' || in_stock from public.my_saved_items() where title = 'Oak desk'), '16000/true',
  'the wishlist shows the latest price');
select throws_ok($$select public.record_price(gen_random_uuid(), 1, 'USD', true)$$, '42501', null, 'users can''t record prices');
reset role;

select * from finish();
rollback;
