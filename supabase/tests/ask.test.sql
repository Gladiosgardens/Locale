-- "Where's this from?": asking posts, answers, accepting, and crediting the answerer.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000003' || x)::uuid, x || 'q@example.com' from unnest(array['0a', '0b', '0c']) x;
update public.profile_private set adult_confirmed_at = now() where profile_id::text like '00000000-0000-0000-0000-0000000003%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-00000000030a'::uuid, 'ask_ana'), ('00000000-0000-0000-0000-00000000030b'::uuid, 'ask_ben'),
             ('00000000-0000-0000-0000-00000000030c'::uuid, 'ask_cy')) v(id, h)
where p.id = v.id;
insert into storage.objects (bucket_id, name) values ('post-media', '30000000-0000-0000-0000-000000000001/0.jpg'),
  ('post-media', '30000000-0000-0000-0000-000000000002/0.jpg');
set local role service_role;
select public.create_post_record('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000030a',
  'Saw this lamp at a cafe, where is it from?', '{}', '[{"path":"30000000-0000-0000-0000-000000000001/0.jpg","width":1,"height":1}]');
select public.create_post_record('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000030a',
  'Normal post', '{}', '[{"path":"30000000-0000-0000-0000-000000000002/0.jpg","width":1,"height":1}]');
reset role;
update public.posts set asking = true where id = '30000000-0000-0000-0000-000000000001';
delete from public.notifications;
create temp table ans (k text primary key, v uuid);
grant all on ans to authenticated, service_role;

-- Ben answers
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000030b","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(id::text) from public.discover_posts(p_asking => true)), array['30000000-0000-0000-0000-000000000001'],
  'the asking filter finds posts asking');
select is((select asking::text || '/' || answer_count from public.discover_posts(p_post_id => '30000000-0000-0000-0000-000000000001')),
  'true/0', 'feeds carry the flag and count');
insert into ans values ('ben', public.submit_answer('30000000-0000-0000-0000-000000000001', 'Brass mushroom lamp',
  'https://lamps.example.com/mushroom', 'Lamp Co', 12900, 'usd', 'Pretty sure it''s this one', 0.4, 0.3));
select throws_ok($$select public.submit_answer('30000000-0000-0000-0000-000000000002', 'X', 'https://a.example.com/x')$$,
  'P0002', 'post_not_found', 'only posts that are asking take answers');
select throws_ok($$select public.submit_answer('30000000-0000-0000-0000-000000000001', 'X', 'https://bit.ly/abc')$$,
  '22023', 'shortened_url', 'answer links follow the same rules as tags');
select throws_ok($$select public.submit_answer('30000000-0000-0000-0000-000000000001', 'X')$$,
  '22023', 'invalid_answer', 'an answer needs a link or a store');
select throws_ok($$select public.accept_answer((select v from ans where k = 'ben'))$$, 'P0002', 'answer_not_found',
  'only the poster accepts');
reset role;
select is((select kind || ':' || actor_id::text from public.notifications), 'answer:00000000-0000-0000-0000-00000000030b',
  'the asker hears about the answer');

-- Cy answers too, then withdraws
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000030c","role":"authenticated"}', true);
set local role authenticated;
insert into ans values ('cy', public.submit_answer('30000000-0000-0000-0000-000000000001', 'Some lamp', null, 'IKEA'));
select is((select count(*)::int from public.list_answers('30000000-0000-0000-0000-000000000001')), 2, 'everyone sees the answers');
select is((select is_mine::text || '/' || can_accept from public.list_answers('30000000-0000-0000-0000-000000000001') where id = (select v from ans where k = 'cy')),
  'true/false', 'answerers see which are theirs');
select public.delete_answer((select v from ans where k = 'cy'));
select is((select count(*)::int from public.list_answers('30000000-0000-0000-0000-000000000001')), 1, 'and can withdraw them');
reset role;

-- Ana can't answer her own; she accepts Ben's
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000030a","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.submit_answer('30000000-0000-0000-0000-000000000001', 'X', null, 'Shop')$$, '22023', 'own_post',
  'askers don''t answer themselves');
select is((select can_accept from public.list_answers('30000000-0000-0000-0000-000000000001')), true, 'the poster can accept');
select lives_ok($$select public.accept_answer((select v from ans where k = 'ben'))$$, 'accepting an answer');
select is((select jsonb_path_query_first(media, '$[0].tags[0].item.title') #>> '{}'
           from public.discover_posts(p_post_id => '30000000-0000-0000-0000-000000000001')),
  'Brass mushroom lamp', 'it becomes a tagged item on the post');
select is((select status from public.list_answers('30000000-0000-0000-0000-000000000001')), 'accepted', 'marked accepted');
select public.set_post_asking('30000000-0000-0000-0000-000000000001', false);
select is((select count(*)::int from public.discover_posts(p_asking => true)), 0, 'found it: no longer asking');
reset role;
select is((select it.created_by::text from public.items it join public.answers a on a.item_id = it.id), '00000000-0000-0000-0000-00000000030b',
  'the item is Ben''s');
select is((select count(*)::int from public.notifications where kind = 'answer_accepted' and recipient_id = '00000000-0000-0000-0000-00000000030b'),
  1, 'Ben hears his answer was used');

-- Cy shops it: Ben gets the credit
create temp table item as select item_id as v from public.answers where status = 'accepted';
grant all on item to authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000030c","role":"authenticated"}', true);
set local role authenticated;
select is((select url from public.start_shop_click('30000000-0000-0000-0000-000000000001', (select v from item))),
  'https://lamps.example.com/mushroom', 'shopping the accepted answer');
reset role;
select is((select poster_id::text || '/' || credit_poster from public.affiliate_clicks), '00000000-0000-0000-0000-00000000030b/true',
  'credits the answerer, not the poster');

select * from finish();
rollback;
