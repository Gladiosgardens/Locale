// Turns claimed notification rows into Expo push messages and reads Expo's
// tickets. Pure TypeScript so Jest can test it.

export type NotificationRow = {
  id: number;
  kind: 'message' | 'message_request' | 'group_join_request' | 'group_join_approved' | 'new_follower' | 'comment' | 'reply' | 'mention' | 'comment_mention' | 'tag' | 'sale' | 'first_sale' | 'weekly_earnings' | 'payout_sent' | 'answer' | 'answer_accepted';
  actor_id?: string | null;
  actor_name: string | null;
  group_name: string | null;
  conversation_id: string | null;
  group_id: string | null;
  post_id?: string | null;
  /** Amounts and item names for earnings pushes. */
  data?: { cents?: number; count?: number; item?: string | null } | null;
  tokens: string[];
};

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: { url: string };
  sound: 'default';
  priority: 'high';
};

export type ExpoTicket = { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };

export const EXPO_CHUNK = 100;

const clip = (s: string | null, max = 60) => {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const usd = (cents: number | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`;

// No message text ever goes into a push: only who, and what kind of event.
export function describe(row: NotificationRow): { title: string; body: string; url: string } | null {
  const actor = clip(row.actor_name) || 'Someone';
  const group = clip(row.group_name) || 'Your group';
  switch (row.kind) {
    case 'message':
      return row.conversation_id ? { title: actor, body: 'Sent you a message', url: `/messages/${row.conversation_id}` } : null;
    case 'message_request':
      return row.conversation_id
        ? { title: 'New message request', body: `${actor} wants to message you`, url: `/messages/${row.conversation_id}` }
        : null;
    case 'group_join_request':
      return row.group_id ? { title: group, body: `${actor} asked to join`, url: `/groups/${row.group_id}` } : null;
    case 'group_join_approved':
      return row.group_id ? { title: group, body: 'Your request to join was approved', url: `/groups/${row.group_id}` } : null;
    case 'comment':
      return row.post_id ? { title: actor, body: 'Commented on your post', url: `/post/${row.post_id}` } : null;
    case 'reply':
      return row.post_id ? { title: actor, body: 'Replied to your comment', url: `/post/${row.post_id}` } : null;
    case 'mention':
      return row.post_id ? { title: actor, body: 'Mentioned you in a post', url: `/post/${row.post_id}` } : null;
    case 'comment_mention':
      return row.post_id ? { title: actor, body: 'Mentioned you in a comment', url: `/comments/${row.post_id}` } : null;
    case 'tag':
      return row.post_id ? { title: actor, body: 'Tagged you in a post', url: `/post/${row.post_id}` } : null;
    case 'answer':
      return row.post_id ? { title: actor, body: 'Suggested where it’s from', url: `/answers/${row.post_id}` } : null;
    case 'answer_accepted':
      return row.post_id
        ? { title: actor, body: 'Used your find. You’ll earn when people buy through it.', url: `/post/${row.post_id}` }
        : null;
    case 'first_sale':
      return {
        title: 'Your first sale on Locale!',
        body: `Someone bought ${row.data?.item ? clip(row.data.item, 40) : 'an item'} through your post. You’ll earn ${usd(row.data?.cents)}.`,
        url: '/earnings',
      };
    case 'sale': {
      const n = row.data?.count ?? 1;
      return {
        title: n > 1 ? `${n} sales from your post` : 'You made a sale',
        body: `${n > 1 ? 'People bought' : 'Someone bought'} ${row.data?.item ? clip(row.data.item, 40) : 'an item'}. You’ll earn ${usd(row.data?.cents)} once it’s final.`,
        url: '/earnings',
      };
    }
    case 'weekly_earnings': {
      const n = row.data?.count ?? 0;
      return {
        title: `You earned ${usd(row.data?.cents)} this week`,
        body: `From ${n} ${n === 1 ? 'sale' : 'sales'} through your posts.`,
        url: '/earnings',
      };
    }
    case 'payout_sent':
      return { title: 'Payout sent', body: `${usd(row.data?.cents)} is on its way to your bank.`, url: '/earnings' };
    case 'new_follower':
      return row.actor_id ? { title: actor, body: 'Started following you', url: `/profile/${row.actor_id}` } : null;
    default:
      return null;
  }
}

export function buildMessages(rows: NotificationRow[]): ExpoMessage[] {
  const out: ExpoMessage[] = [];
  for (const row of rows) {
    const d = describe(row);
    if (!d) continue;
    for (const to of new Set(row.tokens)) {
      out.push({ to, title: d.title, body: d.body, data: { url: d.url }, sound: 'default', priority: 'high' });
    }
  }
  return out;
}

export function chunk<T>(items: T[], size = EXPO_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Tokens Expo says are no longer valid; tickets line up with messages by index.
export function deadTokens(messages: ExpoMessage[], tickets: ExpoTicket[]): string[] {
  const dead = new Set<string>();
  tickets.forEach((t, i) => {
    if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' && messages[i]) dead.add(messages[i].to);
  });
  return [...dead];
}

// Constant-time string comparison for the shared secret.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
