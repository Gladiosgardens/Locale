-- Detection limits, the shopping switch, and Find-similar sources.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000000b' || x)::uuid, x || 'd@example.com' from unnest(array['0a', '0b']) x;
update public.profile_private set adult_confirmed_at = now() where profile_id::text like '00000000-0000-0000-0000-000000000b%';
update public.profiles p set handle = v.h, display_name = v.h, onboarded_at = now()
from (values ('00000000-0000-0000-0000-000000000b0a'::uuid, 'det_ana'), ('00000000-0000-0000-0000-000000000b0b'::uuid, 'det_ben')) v(id, h)
where p.id = v.id;
insert into public.posts (id, author_id, status, searchable, shopping_enabled) values
  ('bb000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000b0a', 'published', true, true),
  ('bb000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000b0a', 'published', true, false);
insert into public.post_media (id, post_id, storage_path, width, height, position) values
  ('bc000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001/0.jpg', 10, 10, 0),
  ('bc000000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-000000000002/0.jpg', 10, 10, 0);
insert into public.items (id, created_by, title) values
  ('bd000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000b0a', 'Wool coat'),
  ('bd000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000b0a', 'Lamp');
insert into public.item_tags (post_media_id, item_id, x, y) values
  ('bc000000-0000-0000-0000-000000000001', 'bd000000-0000-0000-0000-000000000001', 0.5, 0.5),
  ('bc000000-0000-0000-0000-000000000002', 'bd000000-0000-0000-0000-000000000002', 0.5, 0.5);

set local role service_role;
select is((select bool_and(ok) from (select public.use_detection('00000000-0000-0000-0000-000000000b0a', 'detect', 3) ok
           from generate_series(1, 3)) x), true, 'uses up to the daily limit are allowed');
select is(public.use_detection('00000000-0000-0000-0000-000000000b0a', 'detect', 3), false, 'the next one is refused');
select is(public.use_detection('00000000-0000-0000-0000-000000000b0a', 'similar', 3), true, 'limits are counted per kind');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b0b","role":"authenticated"}', true);
set local role authenticated;
select throws_ok('select * from public.detection_log', '42501', null, 'the log is private');
select throws_ok($$select public.use_detection(auth.uid(), 'detect', 100)$$, '42501', null, 'clients cannot record uses themselves');
select is((select storage_path || '|' || title from public.similar_item_source('bd000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001')),
  'bb000000-0000-0000-0000-000000000001/0.jpg|Wool coat', 'viewers get the photo and name for Find similar');
select is((select count(*)::int from public.similar_item_source('bd000000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-000000000002')), 0,
  'never for posts with shopping turned off');
select is((select count(*)::int from public.similar_item_source('bd000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000002')), 0,
  'and only for an item that is on that post');

select public.set_shopping_default(false);
select is((select shopping_default from public.profile_private), false, 'people can make no-shopping their default');

select * from finish();
rollback;
