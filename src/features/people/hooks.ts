import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { follow, unfollow } from '@/features/profiles/api';
import * as api from './api';
import { readContactEmails } from './contacts';

export function usePeopleSearch(query: string) {
  const q = query.trim().replace(/^@/, '');
  return useQuery({
    queryKey: ['people', 'search', q.toLowerCase()],
    queryFn: () => api.searchPeople(q),
    enabled: q.length >= api.MIN_PEOPLE_QUERY,
    staleTime: 30_000,
  });
}

export function useSuggestions() {
  return useQuery({ queryKey: ['people', 'suggested'], queryFn: api.suggestedPeople, staleTime: 5 * 60_000 });
}

export type ContactsOutcome = { status: 'ok'; people: api.Person[]; checked: number } | { status: 'denied' | 'unsupported' };

export function useFindContacts() {
  return useMutation({
    mutationFn: async (): Promise<ContactsOutcome> => {
      const read = await readContactEmails();
      if (read.status !== 'ok') return read;
      const hashes = await api.hashEmails(read.emails);
      return { status: 'ok', people: await api.matchContacts(hashes), checked: hashes.length };
    },
  });
}

export function useFollowPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, follow: on }: { id: string; follow: boolean }) => (on ? follow(id) : unfollow(id)),
    onSettled: (_d, _e, { id }) => {
      qc.invalidateQueries({ queryKey: ['profile', id] });
      qc.invalidateQueries({ queryKey: ['feed', 'following'] });
    },
  });
}
