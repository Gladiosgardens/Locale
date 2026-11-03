-- Push notification outbox: who gets notified, deduplication, preferences, delivery RPCs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- A and B connected (mutual follows); C a stranger; M a group moderator; O the owner; all near Downtown.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000005' || x)::uuid, x || '5@example.com'
from unnest(array['0a', '0b', '0c', '0d', '0e']) as x;
insert into public.areas (geohash5, name, center_lat, center_lng)
values ('9q9k5', 'Downtown', (public.geohash_center('9q9k5')).lat, (public.geohash_center('9q9k5')).lng)
on conflict (geohash5) do nothing;
update public.profile_private set adult_confirmed_at = now(),
  area_id = (select id from public.areas where geohash5 = '9q9k5')
where profile_id::text like '00000000-0000-0000-0000-0000000005%';
update public.profiles p set handle = v.h, display_name = initcap(v.h), onboarded_at = now()
from (values ('00000000-0000-0000-0000-00000000050a'::uuid, 'abe'),
             ('00000000-0000-0000-0000-00000000050b'::uuid, 'bo_b'),
             ('00000000-0000-0000-0000-00000000050c'::uuid, 'cass'),
             ('00000000-0000-0000-0000-00000000050d'::uuid, 'mods'),
             ('00000000-0000-0000-0000-00000000050e'::uuid, 'owen')) as v(id, h)
where p.id = v.id;
insert into public.follows values
  ('00000000-0000-0000-0000-00000000050a', '00000000-0000-0000-0000-00000000050b', now()),
  ('00000000-0000-0000-0000-00000000050b', '00000000-0000-0000-0000-00000000050a', now());

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;

------------------------------------------------------------------------------
-- Device tokens
------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050b","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.register_push_token('not-a-token', 'ios')$$, '22023', 'invalid_push_token',
  'malformed tokens are rejected');
select lives_ok($$select public.register_push_token('ExponentPushToken[bbbbbbbbbbbb]', 'ios')$$, 'B registers a device');
select throws_ok($$select * from public.push_tokens$$, '42501', null, 'tokens are never readable by clients');
select throws_ok($$select * from public.notifications$$, '42501', null, 'nor is the outbox');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050c","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.register_push_token('ExponentPushToken[cccccccccccc]', 'android')$$, 'C registers a device');
select lives_ok($$select public.unregister_push_token('ExponentPushToken[bbbbbbbbbbbb]')$$,
  'C cannot unregister B''s token (silently ignored)');
reset role;
select is((select profile_id::text from public.push_tokens where token = 'ExponentPushToken[bbbbbbbbbbbb]'),
  '00000000-0000-0000-0000-00000000050b', 'B''s token is untouched');

------------------------------------------------------------------------------
-- Messages
------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050a","role":"authenticated"}', true);
set local role authenticated;
insert into ids values ('ab', public.send_message(p_to => '00000000-0000-0000-0000-00000000050b', p_body => 'Secret plans'));
select public.send_message(p_conversation_id => (select v from ids where k = 'ab'), p_body => 'Second');
select public.send_message(p_conversation_id => (select v from ids where k = 'ab'), p_body => 'Third');
reset role;

select is((select count(*)::int from public.notifications where recipient_id = '00000000-0000-0000-0000-00000000050b'), 1,
  'three quick messages produce one pending notification');
select is((select kind from public.notifications where recipient_id = '00000000-0000-0000-0000-00000000050b'), 'message',
  'a message from a connection is a "message"');
select is((select count(*)::int from public.notifications where recipient_id = '00000000-0000-0000-0000-00000000050a'), 0,
  'senders are not notified of their own messages');

-- C (stranger) -> B: a request.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050c","role":"authenticated"}', true);
set local role authenticated;
insert into ids values ('cb', public.send_message(p_to => '00000000-0000-0000-0000-00000000050b', p_body => 'Hi stranger'));
reset role;
select is((select kind from public.notifications where conversation_id = (select v from ids where k = 'cb')),
  'message_request', 'a stranger''s first message is a "message_request"');

------------------------------------------------------------------------------
-- Delivery RPCs
------------------------------------------------------------------------------
set local role service_role;
create temp table claimed as select * from public.claim_notifications(10);
select is((select count(*)::int from claimed), 2, 'the sender claims both pending notifications');
select is((select actor_name || '|' || kind from claimed where kind = 'message'), 'Abe|message',
  'with who it is from');
select is((select tokens from claimed where kind = 'message'), array['ExponentPushToken[bbbbbbbbbbbb]'],
  'and the recipient''s device tokens');
select ok(not exists (select 1 from claimed where row_to_json(claimed)::text like '%Secret plans%'),
  'and never the message text');
select is((select count(*)::int from public.claim_notifications(10)), 0, 'claimed rows are not handed out twice');
select lives_ok($$select public.mark_notifications_sent((select array_agg(id) from claimed))$$, 'mark them sent');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050a","role":"authenticated"}', true);
set local role authenticated;
select public.send_message(p_conversation_id => (select v from ids where k = 'ab'), p_body => 'Fourth');
reset role;
select is((select count(*)::int from public.notifications where recipient_id = '00000000-0000-0000-0000-00000000050b' and sent_at is null), 1,
  'after delivery, a new message notifies again');

-- Preferences
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050b","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.set_notification_preferences(false, null)$$, 'B turns off message notifications');
select is((select notify_messages::text || '|' || notify_groups from public.profile_private), 'false|true',
  'only the message switch changed');
reset role;
delete from public.notifications;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050a","role":"authenticated"}', true);
set local role authenticated;
select public.send_message(p_conversation_id => (select v from ids where k = 'ab'), p_body => 'Fifth');
reset role;
select is((select count(*)::int from public.notifications), 0, 'muted recipients get no notification');

------------------------------------------------------------------------------
-- Groups
------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050e","role":"authenticated"}', true);
set local role authenticated;
insert into ids values ('g', public.create_group('Quiet readers', null, 17::smallint, 'private'));
insert into ids values ('pub', public.create_group('Open runners', null, 6::smallint, 'public'));
reset role;
insert into public.group_members (group_id, profile_id, role, status, joined_at)
values ((select v from ids where k = 'g'), '00000000-0000-0000-0000-00000000050d', 'moderator', 'active', now());
select is((select count(*)::int from public.notifications), 0, 'creating groups and adding members directly notifies no one');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050c","role":"authenticated"}', true);
set local role authenticated;
select public.join_group((select v from ids where k = 'g'));
select public.join_group((select v from ids where k = 'pub'));
reset role;
select is((select array_agg(recipient_id::text order by recipient_id) from public.notifications where kind = 'group_join_request'),
  array['00000000-0000-0000-0000-00000000050d', '00000000-0000-0000-0000-00000000050e'],
  'a request to a private group notifies its owner and moderators');
select is((select count(*)::int from public.notifications where group_id = (select v from ids where k = 'pub')), 0,
  'joining a public group notifies no one');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050a","role":"authenticated"}', true);
set local role authenticated;
select public.join_group((select v from ids where k = 'g'));
reset role;
select is((select count(*)::int from public.notifications where kind = 'group_join_request'), 2,
  'a second request does not pile up more notifications');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050d","role":"authenticated"}', true);
set local role authenticated;
select public.respond_to_join_request((select v from ids where k = 'g'), '00000000-0000-0000-0000-00000000050c', true);
reset role;
select is((select kind || '|' || recipient_id from public.notifications where kind = 'group_join_approved'),
  'group_join_approved|00000000-0000-0000-0000-00000000050c', 'approval notifies the requester');

set local role service_role;
select is((select group_name from public.claim_notifications(50) where kind = 'group_join_approved'), 'Quiet readers',
  'group notifications carry the group name');
select lives_ok($$select public.drop_push_tokens(array['ExponentPushToken[cccccccccccc]'])$$, 'dead tokens can be dropped');
reset role;
select is((select count(*)::int from public.push_tokens where token = 'ExponentPushToken[cccccccccccc]'), 0, 'and are gone');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000050a","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.claim_notifications(1)$$, '42501', null, 'users cannot claim notifications');

select * from finish();
rollback;
