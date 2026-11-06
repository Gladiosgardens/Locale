-- Video posts: ownership of uploads, one video per post, length, feed shape.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000000a' || x)::uuid, x || 'v@example.com' from unnest(array['0a', '0b']) x;
update public.profile_private set adult_confirmed_at = now() where profile_id::text like '00000000-0000-0000-0000-000000000a%';
update public.profiles p set handle = v.h, display_name = v.h, onboarded_at = now()
from (values ('00000000-0000-0000-0000-000000000a0a'::uuid, 'vid_ana'), ('00000000-0000-0000-0000-000000000a0b'::uuid, 'vid_ben')) v(id, h)
where p.id = v.id;
insert into public.video_uploads (upload_id, profile_id, asset_id) values
  ('upAna00000001', '00000000-0000-0000-0000-000000000a0a', 'assetAna0001'),
  ('upBen00000001', '00000000-0000-0000-0000-000000000a0b', 'assetBen0001');

set local role authenticated;
select throws_ok('select * from public.video_uploads', '42501', null, 'clients cannot read video uploads');
select throws_ok($$select public.create_post_record('aa000000-0000-0000-0000-000000000001', auth.uid(), null, '{}',
  '[{"kind":"video","asset_id":"assetAna0001","playback_id":"playAna0001","duration":12,"width":1080,"height":1920}]')$$,
  '42501', null, 'clients cannot create posts directly');
reset role;

set local role service_role;
select throws_ok($$select public.create_post_record('aa000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000a0a', null, '{}',
  '[{"kind":"video","asset_id":"assetBen0001","playback_id":"playBen0001","duration":12,"width":1080,"height":1920}]')$$,
  '22023', 'invalid_video', 'nobody can post someone else''s video');
select throws_ok($$select public.create_post_record('aa000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000a0a', null, '{}',
  '[{"kind":"video","asset_id":"assetAna0001","playback_id":"playAna0001","duration":75,"width":1080,"height":1920}]')$$,
  '22023', 'invalid_video', 'videos over 60 seconds are refused');
select throws_ok($$select public.create_post_record('aa000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000a0a', null, '{}',
  '[{"kind":"video","asset_id":"assetAna0001","playback_id":"playAna0001","duration":12,"width":1080,"height":1920},
    {"path":"aa000000-0000-0000-0000-000000000001/1.jpg","width":10,"height":10}]')$$,
  '22023', 'media_count', 'a video can''t be mixed with photos');
select lives_ok($$select public.create_post_record('aa000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000a0a', 'my desk', '{}',
  '[{"kind":"video","asset_id":"assetAna0001","playback_id":"playAna0001","duration":12.5,"width":1080,"height":1920}]',
  '[{"media":0,"x":0.5,"y":0.5,"item":{"title":"Desk lamp","brand":"BenQ"}}]')$$, 'Ana posts her video with a tagged item');
select throws_ok($$select public.create_post_record('aa000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000a0a', null, '{}',
  '[{"kind":"video","asset_id":"assetAna0001","playback_id":"playAna0001","duration":12,"width":1080,"height":1920}]')$$,
  '22023', 'invalid_video', 'an upload can be used only once');
reset role;

select is((select post_id::text from public.video_uploads where upload_id = 'upAna00000001'),
  'aa000000-0000-0000-0000-000000000001', 'the upload records its post');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a0b","role":"authenticated"}', true);
set local role authenticated;
select is((select media -> 0 ->> 'kind' || '|' || (media -> 0 ->> 'playback_id') || '|' || (media -> 0 ->> 'duration')
           from public.discover_posts(p_post_id => 'aa000000-0000-0000-0000-000000000001')),
  'video|playAna0001|12.5', 'feeds describe the video and its playback id');
select is((select media -> 0 -> 'tags' -> 0 -> 'item' ->> 'title' from public.discover_posts(p_post_id => 'aa000000-0000-0000-0000-000000000001')),
  'Desk lamp', 'with its tagged items');
select is((select media -> 0 ->> 'path' from public.discover_posts(p_post_id => 'aa000000-0000-0000-0000-000000000001')),
  null, 'and no storage path');
reset role;
select throws_ok($$insert into public.post_media (post_id, kind, storage_path, width, height, position)
  values ('aa000000-0000-0000-0000-000000000001', 'video', null, 1, 1, 1)$$, '23514', null, 'a video row must have its Mux ids');

select * from finish();
rollback;
