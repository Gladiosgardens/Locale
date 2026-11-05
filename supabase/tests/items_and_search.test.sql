-- Item tags, link validation, Everywhere feed and item search.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- These tests cover the local features, which use interests retired in global mode.
update public.interests set active = true;

------------------------------------------------------------------------------
-- Link rules
------------------------------------------------------------------------------
select is(public.item_url_host('https://WWW.Ikea.com/us/en/p/sofa?x=1#y'), 'www.ikea.com',
  'host is extracted and lower-cased');
select is(public.item_url_host('https://shop.example.co.uk:8443/a'), 'shop.example.co.uk',
  'an explicit port is allowed');
select is(public.item_url_host('https://example.com./a'), 'example.com', 'trailing dot is normalised');
select throws_ok($$select public.item_url_host('http://example.com/a')$$, '22023', 'invalid_url',
  'http is rejected');
select throws_ok($$select public.item_url_host('https://ikea.com@evil.example/a')$$, '22023',
  'invalid_url', 'user@host tricks are rejected');
select throws_ok($$select public.item_url_host('https://192.168.1.10/a')$$, '22023', 'invalid_url',
  'IP addresses are rejected');
select throws_ok($$select public.item_url_host('https://аpple.com/a')$$, '22023', 'invalid_url',
  'non-ASCII (lookalike) host names are rejected');
select throws_ok($$select public.item_url_host('https://localhost/a')$$, '22023', 'invalid_url',
  'single-label hosts are rejected');
select throws_ok($$select public.item_url_host('https://example.com/a b')$$, '22023', 'invalid_url',
  'whitespace is rejected');
select throws_ok($$select public.item_url_host('https://bit.ly/3xyz')$$, '22023', 'shortened_url',
  'link shorteners are rejected');
select throws_ok($$select public.item_url_host('https://amzn.to/abc')$$, '22023', 'shortened_url',
  'retailer shorteners are rejected too');

------------------------------------------------------------------------------
-- Fixtures: A (9q9k5) and B (9q9k7, neighbour) nearby; F in Los Angeles.
------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'a2@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'b2@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'f2@example.com');

insert into public.areas (geohash5, name, center_lat, center_lng)
select g, n, (public.geohash_center(g)).lat, (public.geohash_center(g)).lng
from (values ('9q9k5', 'Downtown'), ('9q9k7', 'Northside'), ('9q5ct', 'Los Angeles')) as v(g, n)
on conflict (geohash5) do nothing;

update public.profile_private pp set area_id = a.id, adult_confirmed_at = now()
from (values ('00000000-0000-0000-0000-0000000000a2'::uuid, '9q9k5'),
             ('00000000-0000-0000-0000-0000000000b2'::uuid, '9q9k7'),
             ('00000000-0000-0000-0000-0000000000f2'::uuid, '9q5ct')) as v(uid, g)
join public.areas a on a.geohash5 = v.g
where pp.profile_id = v.uid;

update public.profiles set handle = h, display_name = initcap(h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-0000000000a2'::uuid, 'amy'),
             ('00000000-0000-0000-0000-0000000000b2'::uuid, 'bob'),
             ('00000000-0000-0000-0000-0000000000f2'::uuid, 'fay')) as v(uid, h)
where id = v.uid;

insert into storage.objects (bucket_id, name)
select 'post-media', p || '/0.jpg'
from unnest(array['a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
                  'a0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000004',
                  'e0000000-0000-0000-0000-000000000009']) as p;

set local role service_role;

-- Tag validation (each attempt rolls back on its own).
select throws_ok($$select public.create_post_record('e0000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-0000000000a2', null, '{}',
  '[{"path":"e0000000-0000-0000-0000-000000000009/0.jpg","width":10,"height":10}]',
  (select jsonb_agg(jsonb_build_object('media', 0, 'x', 0.1 * g, 'y', 0.5, 'item', jsonb_build_object('title', 'Thing ' || g)))
   from generate_series(1, 6) g))$$,
  '22023', 'too_many_tags', 'at most 5 tags per photo');
select throws_ok($$select public.create_post_record('e0000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-0000000000a2', null, '{}',
  '[{"path":"e0000000-0000-0000-0000-000000000009/0.jpg","width":10,"height":10}]',
  (select jsonb_agg(jsonb_build_object('media', 0, 'x', 0.5, 'y', 0.5, 'item', jsonb_build_object('title', 'Thing ' || g)))
   from generate_series(1, 21) g))$$,
  '22023', 'too_many_tags', 'at most 20 tags per post');
select throws_ok($$select public.create_post_record('e0000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-0000000000a2', null, '{}',
  '[{"path":"e0000000-0000-0000-0000-000000000009/0.jpg","width":10,"height":10}]',
  '[{"media":1,"x":0.5,"y":0.5,"item":{"title":"Lamp"}}]')$$,
  '22023', 'invalid_tag', 'a tag must point at one of the post''s photos');
select throws_ok($$select public.create_post_record('e0000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-0000000000a2', null, '{}',
  '[{"path":"e0000000-0000-0000-0000-000000000009/0.jpg","width":10,"height":10}]',
  '[{"media":0,"x":1.5,"y":0.5,"item":{"title":"Lamp"}}]')$$,
  '22023', 'invalid_tag', 'tag position must be inside the photo');
select throws_ok($$select public.create_post_record('e0000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-0000000000a2', null, '{}',
  '[{"path":"e0000000-0000-0000-0000-000000000009/0.jpg","width":10,"height":10}]',
  '[{"media":0,"x":0.5,"y":0.5,"item":{"title":"  "}}]')$$,
  '22023', 'invalid_tag', 'an item needs a name');
select throws_ok($$select public.create_post_record('e0000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-0000000000a2', null, '{}',
  '[{"path":"e0000000-0000-0000-0000-000000000009/0.jpg","width":10,"height":10}]',
  '[{"media":0,"x":0.5,"y":0.5,"item":{"title":"Lamp","price_cents":1999}}]')$$,
  '22023', 'invalid_tag', 'a price needs a currency');
select throws_ok($$select public.create_post_record('e0000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-0000000000a2', null, '{}',
  '[{"path":"e0000000-0000-0000-0000-000000000009/0.jpg","width":10,"height":10}]',
  '[{"media":0,"x":0.5,"y":0.5,"item":{"title":"Lamp","is_affiliate":true}}]')$$,
  '22023', 'invalid_tag', 'an affiliate flag needs a link');
select throws_ok($$select public.create_post_record('e0000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-0000000000a2', null, '{}',
  '[{"path":"e0000000-0000-0000-0000-000000000009/0.jpg","width":10,"height":10}]',
  '[{"media":0,"x":0.5,"y":0.5,"item":{"title":"Lamp","url":"https://bit.ly/x"}}]')$$,
  '22023', 'shortened_url', 'link rules apply to tags');
select is((select count(*)::int from public.posts where id = 'e0000000-0000-0000-0000-000000000009'),
  0, 'a rejected tag leaves no post behind');

-- The real fixtures.
select public.create_post_record('a0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-0000000000a2', 'New living room', '{}',
  '[{"path":"a0000000-0000-0000-0000-000000000001/0.jpg","width":1000,"height":800}]',
  '[{"media":0,"x":0.3,"y":0.6,"item":{"title":"Linen sofa","brand":"IKEA","store_name":"IKEA",
     "url":"https://WWW.IKEA.com/us/p/sofa","price_cents":89900,"currency":"usd","is_affiliate":true}},
    {"media":0,"x":0.8,"y":0.2,"item":{"title":"Brass lamp","store_name":"Flea market"}}]');
select public.create_post_record('a0000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-0000000000a2', 'Puddle season', array[3]::smallint[],
  '[{"path":"a0000000-0000-0000-0000-000000000002/0.jpg","width":800,"height":800}]',
  '[{"media":0,"x":0.5,"y":0.9,"item":{"title":"Toddler rain boots","url":"https://example.com/boots"}}]');
select public.create_post_record('a0000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-0000000000a2', 'Keeping this one local', '{}',
  '[{"path":"a0000000-0000-0000-0000-000000000003/0.jpg","width":800,"height":800}]',
  '[{"media":0,"x":0.5,"y":0.5,"item":{"title":"Linen shirt"}}]', false);
select public.create_post_record('f0000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-0000000000f2', 'LA sunshine', '{}',
  '[{"path":"f0000000-0000-0000-0000-000000000004/0.jpg","width":800,"height":800}]',
  '[{"media":0,"x":0.5,"y":0.5,"item":{"title":"Linen dress","brand":"Reformation"}}]');

select is((select url_host || '|' || currency from public.items where title = 'Linen sofa'),
  'www.ikea.com|USD', 'server derives the host and normalises currency');
select is((select url_host from public.items where title = 'Brass lamp'), null,
  'items without a link have no host');
reset role;

-- Spread publish times so ordering is deterministic: P4 newest, then P3, P2, P1.
update public.posts p set published_at = now() - v.ago
from (values ('a0000000-0000-0000-0000-000000000001'::uuid, interval '4 hours'),
             ('a0000000-0000-0000-0000-000000000002'::uuid, interval '3 hours'),
             ('a0000000-0000-0000-0000-000000000003'::uuid, interval '2 hours'),
             ('f0000000-0000-0000-0000-000000000004'::uuid, interval '1 hour')) as v(id, ago)
where p.id = v.id;

------------------------------------------------------------------------------
-- F, far away in Los Angeles
------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
set local role authenticated;

select is((select array_agg(id::text) from public.nearby_feed()),
  array['f0000000-0000-0000-0000-000000000004'], 'F''s Nearby feed is still only local');
select is((select array_agg(id::text order by published_at desc) from public.discover_posts()),
  array['f0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001'],
  'Everywhere shows public posts from anywhere, but not kid-tagged or nearby-only ones');
select is((select area_name from public.discover_posts() where id = 'a0000000-0000-0000-0000-000000000001'),
  null, 'far-away viewers do not see the poster''s area');
select is((select area_name from public.discover_posts() where id = 'f0000000-0000-0000-0000-000000000004'),
  'Los Angeles', 'own posts keep their area');
select is((select author_handle from public.discover_posts() where id = 'a0000000-0000-0000-0000-000000000001'),
  'amy', 'far-away viewers see the poster''s handle');
select is((select jsonb_array_length(media -> 0 -> 'tags') from public.discover_posts()
           where id = 'a0000000-0000-0000-0000-000000000001'), 2, 'discovered posts carry their tags');

select is((select array_agg(id::text order by published_at desc) from public.discover_posts('linen')),
  array['f0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001'],
  'search finds matching items everywhere, excluding nearby-only posts');
select is((select array_agg(id::text) from public.discover_posts('IKEA sof')),
  array['a0000000-0000-0000-0000-000000000001'], 'search matches brand + title prefixes');
select is((select cardinality(matched_item_ids) from public.discover_posts('lamp')), 1,
  'search reports which items matched');
select is((select count(*)::int from public.discover_posts('boots')), 0,
  'kid-tagged posts are not searchable from far away');
select throws_ok($$select * from public.discover_posts('x')$$, '22023', 'query_too_short',
  'one-letter searches are refused');
select is((select count(*)::int from public.discover_posts(p_limit => 1,
  p_before_published_at => now() - interval '90 minutes', p_before_id => null)), 1,
  'discovery paginates by time');

select is((select count(*)::int from public.posts where author_id = '00000000-0000-0000-0000-0000000000a2'), 0,
  'the posts table itself stays nearby-only (no far-away area ids)');
select is((select count(*)::int from public.items where created_by = '00000000-0000-0000-0000-0000000000a2'), 0,
  'items are not readable directly from far away');
select is((select count(*)::int from storage.objects where name like 'a0000000-0000-0000-0000-000000000001/%'), 1,
  'F can load the image of a public post');
select is((select count(*)::int from storage.objects
           where name like 'a0000000-0000-0000-0000-000000000002/%'
              or name like 'a0000000-0000-0000-0000-000000000003/%'), 0,
  'F cannot load images of kid-tagged or nearby-only posts');

------------------------------------------------------------------------------
-- B, A's neighbour
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.discover_posts()
           where id::text like 'a0000000%'), 3, 'neighbours see all of A''s posts in Everywhere');
select is((select area_name from public.discover_posts() where id = 'a0000000-0000-0000-0000-000000000003'),
  'Downtown', 'neighbours see the area');
select is((select array_agg(id::text) from public.discover_posts('boots')),
  array['a0000000-0000-0000-0000-000000000002'], 'neighbours can find kid-tagged posts');
select is((select jsonb_path_query_first(media, '$[0].tags[*].item ? (@.title == "Linen sofa").url_host') #>> '{}'
           from public.nearby_feed()
           where id = 'a0000000-0000-0000-0000-000000000001'),
  'www.ikea.com', 'the Nearby feed includes tags too');
select is((select count(*)::int from public.items where created_by = '00000000-0000-0000-0000-0000000000a2'), 4,
  'neighbours can read the items directly');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select * from public.discover_posts()$$, '42501', null, 'anon cannot discover');

select * from finish();
rollback;
