import { Redirect } from 'expo-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMyProfile } from '@/features/onboarding/hooks';

// The app's start address ("/"). Sends people to the right place for where
// they are: sign-in, onboarding, or the feed. The root layout only renders
// this after auth and the profile have loaded.
export default function Start() {
  const { session } = useAuth();
  const profile = useMyProfile();
  if (!session) return <Redirect href="/sign-in" />;
  if (!profile.data?.onboarded_at) return <Redirect href="/area" />;
  return <Redirect href="/home" />;
}
