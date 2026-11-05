import { useAuth } from '@/features/auth/AuthProvider';
import { ProfileView } from '@/features/profiles/ProfileView';

export default function Me() {
  const { session } = useAuth();
  return <ProfileView id={session?.user.id} isTab />;
}
