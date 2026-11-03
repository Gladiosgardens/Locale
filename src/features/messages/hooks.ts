import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import * as api from './api';

const POLL_MS = 20_000;

export function useConversations(requests: boolean) {
  return useQuery({
    queryKey: ['conversations', requests ? 'requests' : 'inbox'],
    queryFn: () => api.listConversations(requests),
    refetchInterval: POLL_MS,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({ queryKey: ['conversation', id], queryFn: () => api.getConversation(id!), enabled: !!id });
}

export function useMessages(id: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['messages', id],
    queryFn: ({ pageParam }) => api.fetchMessages(id!, pageParam),
    initialPageParam: null as api.MessageCursor,
    getNextPageParam: (last) =>
      last.length < api.MESSAGE_PAGE_SIZE ? undefined : { createdAt: last[last.length - 1].createdAt, id: last[last.length - 1].id },
    enabled: !!id,
    // Realtime pushes new messages; polling is the fallback.
    refetchInterval: POLL_MS,
  });
}

// New messages arrive over Supabase Realtime. Row-level security decides
// who receives each insert, so only the two people in the conversation do.
export function useLiveMessages(id: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`messages:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ['messages', id] });
        qc.invalidateQueries({ queryKey: ['conversations'] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, qc]);
}

function useRefreshMessaging() {
  const qc = useQueryClient();
  return (conversationId?: string) => {
    qc.invalidateQueries({ queryKey: ['conversations'] });
    if (conversationId) {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
    }
  };
}

export function useSendMessage() {
  const refresh = useRefreshMessaging();
  return useMutation({ mutationFn: api.sendMessage, onSuccess: (conversationId) => refresh(conversationId) });
}

export function useRespondToMessageRequest(id: string | undefined) {
  const refresh = useRefreshMessaging();
  return useMutation({ mutationFn: (accept: boolean) => api.respondToRequest(id!, accept), onSuccess: () => refresh(id) });
}

export function useHideConversation() {
  const refresh = useRefreshMessaging();
  return useMutation({ mutationFn: api.hideConversation, onSuccess: () => refresh() });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.markRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useMessageStatus(profileId: string | undefined) {
  return useQuery({
    queryKey: ['message-status', profileId],
    queryFn: () => api.getMessageStatus(profileId!),
    enabled: !!profileId,
  });
}

export function useDmPolicy() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['dm-policy', session?.user.id],
    queryFn: () => api.getDmPolicy(session!.user.id),
    enabled: !!session,
  });
  const update = useMutation({
    mutationFn: api.setDmPolicy,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dm-policy'] }),
  });
  return { query, update };
}
