-- Messaging: connections, requests, silent declines, policy, blocks, shared posts, reports.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

-- A, B, C, D, E near Downtown; F in Los Angeles.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000004' || x)::uuid, x || '4@example.com'
from unnest(array['0a', '0b', '0c', '0d', '0e', '0f']) as x;
insert into public.areas (geohash5, name, center_lat, center_lng)
select g, n, (public.geohash_center(g)).lat, (public.geohash_center(g)).lng
from (values ('9q9k5', 'Downtown'), ('9q5ct', 'Los Angeles')) as v(g, n)
on conflict (geohash5) do nothing;
update public.profile_private pp set adult_confirmed_at = now(),
  area_id = (select id from public.areas where geohash5 = case when pp.profile_id::text like '%40f' then '9q5ct' else '9q9k5' end)
where pp.profile_id::text like '00000000-0000-0000-0000-0000000004%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-00000000040a'::uuid, 'ada'),
             ('00000000-0000-0000-0000-00000000040b'::uuid, 'ben'),
             ('00000000-0000-0000-0000-00000000040c'::uuid, 'cal'),
             ('00000000-0000-0000-0000-00000000040d'::uuid, 'dot'),
             ('00000000-0000-0000-0000-00000000040e'::uuid, 'eve'),
             ('00000000-0000-0000-0000-00000000040f'::uuid, 'fin')) as v(id, h)
where p.id = v.id;

-- A and B follow each other; A and E share a group; D accepts connections only.
insert into public.follows values
  ('00000000-0000-0000-0000-00000000040a', '00000000-0000-0000-0000-00000000040b', now()),
  ('00000000-0000-0000-0000-00000000040b', '00000000-0000-0000-0000-00000000040a', now());
insert into public.groups (id, name, interest_id, area_id, privacy, created_by)
select 'e0000000-0000-0000-0000-0000000000aa', 'Runners', 6, id, 'public', '00000000-0000-0000-0000-00000000040a'
from public.areas where geohash5 = '9q9k5';
insert into public.group_members (group_id, profile_id, role, status, joined_at) values
  ('e0000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000040a', 'owner', 'active', now()),
  ('e0000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000040e', 'member', 'active', now());
update public.profile_private set dm_policy = 'connections' where profile_id = '00000000-0000-0000-0000-00000000040d';

-- Posts to share: A's public post and A's kid-tagged (local-only) post.
insert into storage.objects (bucket_id, name)
select 'post-media', p || '/0.jpg'
from unnest(array['f1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002']) as p;
set local role service_role;
select public.create_post_record('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000040a',
  'Public post', '{}', '[{"path":"f1000000-0000-0000-0000-000000000001/0.jpg","width":1,"height":1}]');
select public.create_post_record('f1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000040a',
  'Kids post', array[3]::smallint[], '[{"path":"f1000000-0000-0000-0000-000000000002/0.jpg","width":1,"height":1}]');
reset role;

create temp table conv (k text primary key, id uuid);
grant all on conv to authenticated;

------------------------------------------------------------------------------
-- Connections message directly
------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040a","role":"authenticated"}', true);
set local role authenticated;

select is((select status from public.message_status('00000000-0000-0000-0000-00000000040b')), 'direct',
  'mutual follows can message directly');
select is((select status from public.message_status('00000000-0000-0000-0000-00000000040e')), 'direct',
  'so can members of the same group');
select is((select status from public.message_status('00000000-0000-0000-0000-00000000040c')), 'request',
  'a stranger gets a request');
select is((select status from public.message_status('00000000-0000-0000-0000-00000000040d')), 'closed',
  'unless they accept connections only');
select throws_ok($$select public.send_message(p_to => '00000000-0000-0000-0000-00000000040b', p_body => '   ')$$,
  '22023', 'empty_message', 'empty messages are rejected');
select throws_ok($$insert into public.messages (conversation_id, sender_id, body)
  values (gen_random_uuid(), '00000000-0000-0000-0000-00000000040a', 'x')$$, '42501', null,
  'messages are sent through the RPC only');

insert into conv values ('ab', public.send_message(p_to => '00000000-0000-0000-0000-00000000040b', p_body => 'Hey Ben!'));
select is(public.send_message(p_conversation_id => (select id from conv where k = 'ab'), p_body => 'Run tomorrow?'),
  (select id from conv where k = 'ab'), 'connections can keep messaging');
select is(public.send_message(p_to => '00000000-0000-0000-0000-00000000040b', p_body => 'Same thread'),
  (select id from conv where k = 'ab'), 'messaging the same person reuses the conversation');
select is((select status from public.message_status('00000000-0000-0000-0000-00000000040b')), 'existing',
  'message_status points at the existing conversation');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040b","role":"authenticated"}', true);
set local role authenticated;
select is((select unread_count from public.my_conversations() where other_handle = 'ada'), 3,
  'B has three unread messages from A in the inbox, not in requests');
select is((select count(*)::int from public.my_conversations(true)), 0, 'B has no requests');
select lives_ok($$select public.mark_conversation_read((select id from conv where k = 'ab'))$$, 'B reads them');
select is((select unread_count from public.my_conversations() where other_handle = 'ada'), 0, 'unread resets');

------------------------------------------------------------------------------
-- Requests from a stranger (C -> A)
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040c","role":"authenticated"}', true);
set local role authenticated;
insert into conv values ('ca', public.send_message(p_to => '00000000-0000-0000-0000-00000000040a', p_body => 'Hi! Saw your post.'));
select throws_ok($$select public.send_message(p_conversation_id => (select id from conv where k = 'ca'), p_body => 'Hello??')$$,
  'P0001', 'awaiting_acceptance', 'a requester can send only one message before acceptance');
select is((select awaiting_reply from public.my_conversations() where other_handle = 'ada'), true,
  'C sees the request as sent');
select is((select count(*)::int from public.conversation_members where profile_id <> '00000000-0000-0000-0000-00000000040c'), 0,
  'C cannot see A''s side of the conversation');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040a","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(other_handle) from public.my_conversations(true)), array['cal'], 'C''s message is in A''s Requests');
select is((select count(*)::int from public.my_conversations() where other_handle = 'cal'), 0, 'not in A''s inbox');
select is((select body from public.conversation_messages((select id from conv where k = 'ca'))), 'Hi! Saw your post.',
  'A can read the request before accepting');
select lives_ok($$select public.respond_to_message_request((select id from conv where k = 'ca'), false)$$,
  'A deletes the request');
select is((select count(*)::int from public.my_conversations(true)), 0, 'it leaves A''s Requests');
select is((select count(*)::int from public.conversation_messages((select id from conv where k = 'ca'))), 0,
  'and A no longer sees it');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040c","role":"authenticated"}', true);
set local role authenticated;
select is((select awaiting_reply from public.my_conversations() where other_handle = 'ada'), true,
  'the decline is silent: C still just sees "request sent"');
select throws_ok($$select public.send_message(p_to => '00000000-0000-0000-0000-00000000040a', p_body => 'Again')$$,
  'P0001', 'awaiting_acceptance', 'and cannot send more');

-- F (LA) requests B; B accepts by replying.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040f","role":"authenticated"}', true);
set local role authenticated;
insert into conv values ('fb', public.send_message(p_to => '00000000-0000-0000-0000-00000000040b', p_body => 'Love your plants'));
select throws_ok($$select public.send_message(p_to => '00000000-0000-0000-0000-00000000040d', p_body => 'Hi')$$,
  '42501', 'messages_closed', 'D''s connections-only setting blocks strangers');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040b","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.send_message(p_conversation_id => (select id from conv where k = 'fb'), p_body => 'Thanks!')$$,
  'B replies, which accepts the request');
select is((select count(*)::int from public.my_conversations(true)), 0, 'the request moved to B''s inbox');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040f","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.send_message(p_conversation_id => (select id from conv where k = 'fb'), p_body => 'Where are they from?')$$,
  'after acceptance F can keep messaging');

------------------------------------------------------------------------------
-- Shared posts respect visibility
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040b","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.send_message(p_conversation_id => (select id from conv where k = 'fb'),
  p_shared_post_id => 'f1000000-0000-0000-0000-000000000002')$$, 'B (nearby) shares A''s kid-tagged post with F');
select lives_ok($$select public.send_message(p_conversation_id => (select id from conv where k = 'fb'),
  p_shared_post_id => 'f1000000-0000-0000-0000-000000000001')$$, 'and A''s public post');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040f","role":"authenticated"}', true);
set local role authenticated;
select is((select shared_post from public.conversation_messages((select id from conv where k = 'fb'))
           where shared_post ? 'unavailable'), '{"unavailable": true}'::jsonb,
  'F, far away, cannot see the kid-tagged post through a message');
select is((select shared_post ->> 'caption' from public.conversation_messages((select id from conv where k = 'fb'))
           where shared_post ->> 'id' = 'f1000000-0000-0000-0000-000000000001'), 'Public post',
  'but does see the public one');
select is((select count(*)::int from storage.objects where name like 'f1000000-0000-0000-0000-000000000002/%'), 0,
  'and cannot load the kid-tagged image');
select throws_ok($$select public.send_message(p_conversation_id => (select id from conv where k = 'fb'),
  p_shared_post_id => 'f1000000-0000-0000-0000-000000000002')$$, 'P0002', 'post_unavailable',
  'nor share a post they cannot see');

------------------------------------------------------------------------------
-- Privacy of conversations
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040e","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.messages), 0, 'E cannot read anyone else''s messages');
select is((select count(*)::int from public.conversation_messages((select id from conv where k = 'ab'))), 0,
  'even with the conversation id');
select throws_ok($$select public.send_message(p_conversation_id => (select id from conv where k = 'ab'), p_body => 'Hi')$$,
  'P0002', 'conversation_not_found', 'nor post into it');

------------------------------------------------------------------------------
-- Reporting a message
------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040b","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.report_content('message',
  (select id from public.messages where body = 'Where are they from?'), 'harassment')$$, 'B reports F''s message');
select throws_ok($$select public.report_content('message',
  (select id from public.messages where body = 'Thanks!'), 'spam')$$, 'P0002', 'report_target_not_found',
  'you cannot report your own message');

reset role;
select is((select snapshot ->> 'body' from public.reports where target_type = 'message'), 'Where are they from?',
  'the report keeps a copy of the reported message for reviewers');
set local role service_role;
select lives_ok($$select public.resolve_report('message',
  (select target_id from public.reports where target_type = 'message'), 'remove')$$, 'a reviewer removes it');
reset role;
select is((select body is null and removed_at is not null from public.messages where id =
  (select target_id from public.reports where target_type = 'message')), true, 'removing clears the message text');

------------------------------------------------------------------------------
-- Blocks end messaging
------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040b","role":"authenticated"}', true);
set local role authenticated;
select public.block_user('00000000-0000-0000-0000-00000000040a');
select is((select count(*)::int from public.my_conversations() where other_handle = 'ada'), 0,
  'blocking hides the conversation from the blocker');
select is((select count(*)::int from public.conversation_messages((select id from conv where k = 'ab'))), 0,
  'and its messages');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000040a","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.my_conversations() where other_handle = 'ben'), 0,
  'and from the blocked person');
select throws_ok($$select public.send_message(p_to => '00000000-0000-0000-0000-00000000040b', p_body => 'Hello?')$$,
  '42501', 'cannot_message', 'the blocked person cannot send');
select is((select status from public.message_status('00000000-0000-0000-0000-00000000040b')), 'closed',
  'and sees messaging as closed');
select is((select count(*)::int from public.messages where sender_id = '00000000-0000-0000-0000-00000000040b'), 0,
  'and cannot read the blocker''s past messages directly');

------------------------------------------------------------------------------
-- Settings and anon
------------------------------------------------------------------------------
select lives_ok($$select public.set_dm_policy('connections')$$, 'A switches to connections only');
select throws_ok($$select public.set_dm_policy('nobody')$$, '22023', 'invalid_setting', 'unknown settings are rejected');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select * from public.my_conversations()$$, '42501', null, 'anon has no inbox');

select * from finish();
rollback;
