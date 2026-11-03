import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { signOut } from '@/features/auth/api';
import { useMyProfile } from '@/features/onboarding/hooks';
import { useBlocked, useUnblockUser } from '@/features/safety/hooks';
import { friendlyError } from '@/lib/errors';

export default function Settings() {
  const { session } = useAuth();
  const profile = useMyProfile();
  const blocked = useBlocked();
  const unblock = useUnblockUser();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">Settings</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Text style={styles.text}>
            {profile.data?.display_name} <Text style={styles.muted}>@{profile.data?.handle}</Text>
          </Text>
          <Text style={styles.muted}>{session?.user.email}</Text>
          {profile.data?.area ? <Text style={styles.muted}>Area: {profile.data.area.name}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Blocked accounts</Text>
          {blocked.isPending ? (
            <ActivityIndicator color={colors.accent} />
          ) : blocked.isError ? (
            <Text style={styles.muted}>Couldn’t load blocked accounts.</Text>
          ) : blocked.data.length === 0 ? (
            <Text style={styles.muted}>You haven’t blocked anyone. You can block someone from the ••• menu on their post.</Text>
          ) : (
            blocked.data.map((b) => (
              <View key={b.profileId} style={styles.row}>
                <Text style={styles.text}>
                  {b.displayName} <Text style={styles.muted}>@{b.handle}</Text>
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${b.handle}`}
                  onPress={() =>
                    Alert.alert(`Unblock @${b.handle}?`, 'You’ll be able to see each other’s posts again.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Unblock',
                        onPress: () => unblock.mutate(b.profileId, { onError: (e) => Alert.alert(friendlyError(e)) }),
                      },
                    ])
                  }
                  hitSlop={8}
                >
                  <Text style={styles.action}>Unblock</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <Button label="Sign out" variant="secondary" onPress={signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  link: { color: colors.muted, fontSize: 15 },
  body: { padding: 16, gap: 24 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  text: { fontSize: 16, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  action: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
