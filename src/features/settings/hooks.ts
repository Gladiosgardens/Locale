import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import * as api from './api';

export function usePrivateSettings() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['private-settings', session?.user.id],
    queryFn: () => api.getPrivateSettings(session!.user.id),
    enabled: !!session,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['private-settings'] });
  const setDmPolicy = useMutation({ mutationFn: api.setDmPolicy, onSuccess: refresh });
  const setNotifications = useMutation({ mutationFn: api.setNotificationPreferences, onSuccess: refresh });
  const setFindable = useMutation({ mutationFn: api.setFindableByEmail, onSuccess: refresh });
  return { query, setDmPolicy, setNotifications, setFindable };
}
