-- Topic sections and the personal For you ranking.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select is((select count(*)::int from public.interests where active and slug in
  ('tech', 'audio', 'desk-setups', 'gaming', 'watches', 'grooming', 'outdoor-gear', 'grilling', 'diy-tools')), 9,
  'tech, gear and grooming topics exist');
select is((select section from public.interests where slug = 'tech'), 'tech', 'tech is in Tech & cars');
select is((select section from public.interests where slug = 'sneakers'), 'style', 'sneakers are in Style');
select is((select count(*)::int from public.interests where active and section = 'everyday'
           and slug not in ('travel-style', 'dogs', 'cats', 'books', 'music', 'board-games')), 0,
  'every active topic has a real section');

-- R picks Tech; F posts tech, S posts style; R follows S.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000008' || x)::uuid, x || '8@example.com' from unnest(array['0a', '0b', '0c']) x;
update public.profile_private set adult_confirmed_at = now() where profile_id::text like '00000000-0000-0000-0000-0000000008%';
update public.profiles p set handle = v.h, display_name = v.h, onboarded_at = now()
from (values ('00000000-0000-0000-0000-00000000080a'::uuid, 'reader'),
             ('00000000-0000-0000-0000-00000000080b'::uuid, 'techie'),
             ('00000000-0000-0000-0000-00000000080c'::uuid, 'stylist')) v(id, h)
where p.id = v.id;
insert into public.profile_interests (profile_id, interest_id)
select '00000000-0000-0000-0000-00000000080a', id from public.interests where slug in ('tech', 'audio', 'gaming');
insert into public.follows (follower_id, followee_id)
values ('00000000-0000-0000-0000-00000000080a', '00000000-0000-0000-0000-00000000080c');

-- Posts: newest is untagged (n), then style by a followed author (s, 10h old), then tech (t, 20h old), then old tech (o, 5 days).
insert into public.posts (id, author_id, caption, status, published_at, searchable) values
  ('8b000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000080b', 'n', 'published', now() - interval '1 hour', true),
  ('8b000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000080c', 's', 'published', now() - interval '10 hours', true),
  ('8b000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000080b', 't', 'published', now() - interval '20 hours', true),
  ('8b000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000080b', 'o', 'published', now() - interval '5 days', true);
insert into public.post_interests (post_id, interest_id)
select '8b000000-0000-0000-0000-00000000000c'::uuid, id from public.interests where slug = 'tech'
union all select '8b000000-0000-0000-0000-00000000000d'::uuid, id from public.interests where slug = 'tech'
union all select '8b000000-0000-0000-0000-00000000000b'::uuid, id from public.interests where slug = 'sneakers';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000080a","role":"authenticated"}', true);
set local role authenticated;

select is((select array_agg(caption order by published_at desc) from public.discover_posts(p_limit => 10)
           where caption in ('n', 's', 't', 'o')),
  array['n', 's', 't', 'o'], 'without For you, posts are newest first');
select is((select array_agg(caption) from (select caption from public.discover_posts(p_limit => 10, p_for_you => true)
           where caption in ('n', 's', 't', 'o')) x),
  array['t', 's', 'n', 'o'], 'For you puts my topics first, then people I follow, then the rest');
select ok((select bool_and(rank_at = published_at) from public.discover_posts(p_limit => 10)),
  'outside For you, rank_at is the publish time');

-- Paging through For you one post at a time returns every post once, in order.
create temp table pages (n int, caption text, rank_at timestamptz, id uuid);
insert into pages select 1, caption, rank_at, id from public.discover_posts(p_limit => 1, p_for_you => true);
insert into pages select 2, d.caption, d.rank_at, d.id from (select * from pages where n = 1) p,
  lateral public.discover_posts(p_limit => 1, p_for_you => true, p_before_published_at => p.rank_at, p_before_id => p.id) d;
insert into pages select 3, d.caption, d.rank_at, d.id from (select * from pages where n = 2) p,
  lateral public.discover_posts(p_limit => 1, p_for_you => true, p_before_published_at => p.rank_at, p_before_id => p.id) d;
insert into pages select 4, d.caption, d.rank_at, d.id from (select * from pages where n = 3) p,
  lateral public.discover_posts(p_limit => 1, p_for_you => true, p_before_published_at => p.rank_at, p_before_id => p.id) d;
insert into pages select 5, d.caption, d.rank_at, d.id from (select * from pages where n = 4) p,
  lateral public.discover_posts(p_limit => 1, p_for_you => true, p_before_published_at => p.rank_at, p_before_id => p.id) d;
select is((select array_agg(caption order by n) from pages where caption in ('n', 's', 't', 'o')),
  array['t', 's', 'n', 'o'], 'paging keeps the For you order');
select is((select count(*)::int from pages), (select count(distinct id)::int from pages), 'and never repeats a post');

-- Someone with no topics and no follows just gets newest first.
reset role;
delete from public.profile_interests where profile_id = '00000000-0000-0000-0000-00000000080a';
delete from public.follows where follower_id = '00000000-0000-0000-0000-00000000080a';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000080a","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(caption) from (select caption from public.discover_posts(p_limit => 10, p_for_you => true)
           where caption in ('n', 's', 't', 'o')) x),
  array['n', 's', 't', 'o'], 'with no topics or follows, For you is newest first');
select lives_ok($$select * from public.discover_posts(p_query => 'lamp', p_for_you => true)$$, 'For you combines with other filters');

select * from finish();
rollback;
