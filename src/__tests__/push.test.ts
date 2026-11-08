import { buildMessages, chunk, deadTokens, describe as describeRow, safeEqual, type NotificationRow } from '../../supabase/functions/_shared/push';

const row = (over: Partial<NotificationRow>): NotificationRow => ({
  id: 1, kind: 'message', actor_name: 'Ben', group_name: null, conversation_id: 'c1', group_id: null,
  tokens: ['ExponentPushToken[a]'], ...over,
});

describe('push messages', () => {
  it('never includes message text, only who and what', () => {
    expect(describeRow(row({}))).toEqual({ title: 'Ben', body: 'Sent you a message', url: '/messages/c1' });
    expect(describeRow(row({ kind: 'message_request' }))).toEqual({
      title: 'New message request', body: 'Ben wants to message you', url: '/messages/c1',
    });
    expect(describeRow(row({ kind: 'group_join_request', group_name: 'Toddler parents', group_id: 'g1', conversation_id: null })))
      .toEqual({ title: 'Toddler parents', body: 'Ben asked to join', url: '/groups/g1' });
    expect(describeRow(row({ kind: 'group_join_approved', actor_name: null, group_name: 'Runners', group_id: 'g2' })))
      .toEqual({ title: 'Runners', body: 'Your request to join was approved', url: '/groups/g2' });
  });

  it('opens the post for a new comment, without the comment text', () => {
    expect(describeRow(row({ kind: 'comment', actor_name: 'Ana', post_id: 'p9', conversation_id: null }))).toEqual({
      title: 'Ana',
      body: 'Commented on your post',
      url: '/post/p9',
    });
  });

  it('opens the post for a reply, without the reply text', () => {
    expect(describeRow(row({ kind: 'reply', actor_name: 'Ana', post_id: 'p9', conversation_id: null }))).toEqual({
      title: 'Ana',
      body: 'Replied to your comment',
      url: '/post/p9',
    });
  });

  it('links a new follower to their profile', () => {
    expect(describeRow(row({ kind: 'new_follower', actor_id: 'u9', actor_name: 'Ana', conversation_id: null }))).toEqual({
      title: 'Ana',
      body: 'Started following you',
      url: '/profile/u9',
    });
    expect(describeRow(row({ kind: 'new_follower', actor_id: null, conversation_id: null }))).toBeNull();
  });

  it('clips long names and falls back when missing', () => {
    const long = 'x'.repeat(100);
    expect(describeRow(row({ actor_name: long }))!.title).toHaveLength(60);
    expect(describeRow(row({ actor_name: null }))!.title).toBe('Someone');
  });

  it('fans out to every device once and skips rows without a target', () => {
    const msgs = buildMessages([
      row({ tokens: ['T1', 'T2', 'T1'] }),
      row({ id: 2, kind: 'message', conversation_id: null }),
      row({ id: 3, tokens: [] }),
    ]);
    expect(msgs.map((m) => m.to)).toEqual(['T1', 'T2']);
    expect(msgs[0]).toMatchObject({ sound: 'default', priority: 'high', data: { url: '/messages/c1' } });
  });

  it('chunks to Expo’s batch size', () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it('finds tokens Expo reports as unregistered', () => {
    const msgs = buildMessages([row({ tokens: ['A', 'B', 'C'] })]);
    const dead = deadTokens(msgs, [
      { status: 'ok', id: '1' },
      { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } },
    ]);
    expect(dead).toEqual(['B']);
  });

  it('compares secrets safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
