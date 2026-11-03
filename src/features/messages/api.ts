import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export const MESSAGE_PAGE_SIZE = 50;
export const MAX_MESSAGE = 2000;

export type ConversationRow = {
  id: string;
  otherId: string;
  otherHandle: string;
  otherName: string;
  lastMessage: string | null;
  lastMessageAt: string;
  unread: number;
  awaitingReply: boolean;
};

export type ConversationSummary = {
  id: string;
  otherId: string;
  otherHandle: string;
  otherName: string;
  myState: 'active' | 'request' | 'hidden';
  awaitingReply: boolean;
};

export type SharedPost =
  | { unavailable: true }
  | { unavailable?: false; id: string; caption: string | null; authorHandle: string; imageUrl: string | null };

export type Message = {
  id: string;
  senderId: string;
  body: string | null;
  createdAt: string;
  removed: boolean;
  sharedPost: SharedPost | null;
};

export type MessageCursor = { createdAt: string; id: string } | null;
export type MessageStatus = { status: 'existing' | 'direct' | 'request' | 'closed'; conversationId: string | null };

export async function listConversations(requests: boolean): Promise<ConversationRow[]> {
  const rows = unwrap(await supabase.rpc('my_conversations', requests ? { p_requests: true } : {}));
  return rows.map((r) => ({
    id: r.conversation_id,
    otherId: r.other_id,
    otherHandle: r.other_handle,
    otherName: r.other_display_name,
    lastMessage: r.last_message,
    lastMessageAt: r.last_message_at,
    unread: r.unread_count,
    awaitingReply: r.awaiting_reply,
  }));
}

export async function getConversation(id: string): Promise<ConversationSummary | null> {
  const [r] = unwrap(await supabase.rpc('conversation_summary', { p_conversation_id: id }));
  if (!r) return null;
  return {
    id: r.conversation_id,
    otherId: r.other_id,
    otherHandle: r.other_handle,
    otherName: r.other_display_name,
    myState: r.my_state as ConversationSummary['myState'],
    awaitingReply: r.awaiting_reply,
  };
}

type RawShared = { unavailable?: boolean; id?: string; caption?: string | null; author_handle?: string; media_path?: string | null };

export async function fetchMessages(conversationId: string, cursor: MessageCursor): Promise<Message[]> {
  const rows = unwrap(
    await supabase.rpc('conversation_messages', {
      p_conversation_id: conversationId,
      p_limit: MESSAGE_PAGE_SIZE,
      ...(cursor ? { p_before_created_at: cursor.createdAt, p_before_id: cursor.id } : {}),
    }),
  );
  const paths = rows
    .map((r) => (r.shared_post as RawShared | null)?.media_path)
    .filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const signed = unwrap(await supabase.storage.from('post-media').createSignedUrls(paths, 3600));
    for (const s of signed) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((r) => {
    const sp = r.shared_post as RawShared | null;
    return {
      id: r.id,
      senderId: r.sender_id,
      body: r.body,
      createdAt: r.created_at,
      removed: r.removed,
      sharedPost: !sp
        ? null
        : sp.unavailable
          ? { unavailable: true }
          : {
              id: sp.id!,
              caption: sp.caption ?? null,
              authorHandle: sp.author_handle ?? '',
              imageUrl: sp.media_path ? urls.get(sp.media_path) ?? null : null,
            },
    };
  });
}

export async function getMessageStatus(profileId: string): Promise<MessageStatus> {
  const [r] = unwrap(await supabase.rpc('message_status', { p_profile_id: profileId }));
  return { status: (r?.status ?? 'closed') as MessageStatus['status'], conversationId: r?.conversation_id ?? null };
}

export async function sendMessage(input: {
  to?: string;
  conversationId?: string;
  body?: string;
  sharedPostId?: string;
}): Promise<string> {
  return unwrap(
    await supabase.rpc('send_message', {
      ...(input.to ? { p_to: input.to } : {}),
      ...(input.conversationId ? { p_conversation_id: input.conversationId } : {}),
      ...(input.body?.trim() ? { p_body: input.body.trim() } : {}),
      ...(input.sharedPostId ? { p_shared_post_id: input.sharedPostId } : {}),
    }),
  );
}

export async function respondToRequest(conversationId: string, accept: boolean): Promise<void> {
  check(await supabase.rpc('respond_to_message_request', { p_conversation_id: conversationId, p_accept: accept }));
}

export async function hideConversation(conversationId: string): Promise<void> {
  check(await supabase.rpc('hide_conversation', { p_conversation_id: conversationId }));
}

export async function markRead(conversationId: string): Promise<void> {
  check(await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId }));
}
