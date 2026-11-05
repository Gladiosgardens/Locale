import { useLocalSearchParams } from 'expo-router';
import { ProfileView } from '@/features/profiles/ProfileView';

export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProfileView id={id} />;
}
