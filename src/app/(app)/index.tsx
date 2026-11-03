import { StyleSheet, Text } from 'react-native';
import { Button, colors, Screen } from '@/components/ui';
import { signOut } from '@/features/auth/api';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';

export default function Home() {
  const profile = useMyProfile();
  const interests = useInterests();
  const mine = interests.data?.filter((i) => profile.data?.interestIds.includes(i.id)) ?? [];

  return (
    <Screen
      title={`Hi, ${profile.data?.display_name ?? 'there'}`}
      subtitle={profile.data?.area ? `Your area: ${profile.data.area.name}` : undefined}
    >
      <Text style={styles.text}>Your interests: {mine.map((i) => i.label).join(', ') || '—'}</Text>
      <Text style={styles.muted}>Your nearby feed is coming next.</Text>
      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 16, color: colors.text, lineHeight: 22 },
  muted: { fontSize: 15, color: colors.muted },
});
