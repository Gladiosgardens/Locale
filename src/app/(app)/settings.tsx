import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, colors } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { signOut } from '@/features/auth/api';
import { useEnablePush, usePushPermission } from '@/features/notifications/PushPrompt';
import { useMyProfile } from '@/features/onboarding/hooks';
import { useBlocked, useUnblockUser } from '@/features/safety/hooks';
import { usePrivateSettings } from '@/features/settings/hooks';
import { friendlyError } from '@/lib/errors';
import { LOCAL_FEATURES } from '@/lib/features';
import { fonts, space, type } from '@/theme';

export default function Settings() {
  const { session } = useAuth();
  const profile = useMyProfile();
  const blocked = useBlocked();
  const unblock = useUnblockUser();
  const settings = usePrivateSettings();
  const prefs = settings.query.data;
  const policy = prefs?.dmPolicy;
  const permission = usePushPermission();
  const push = useEnablePush();
  const fail = (e: unknown) => Alert.alert(friendlyError(e));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Settings
        </Text>
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
          <Text style={styles.sectionTitle}>Shopping</Text>
          <View style={styles.row}>
            <Text style={[styles.text, styles.flex]}>Show shopping on my posts by default</Text>
            <Switch
              accessibilityLabel="Show shopping on my posts by default"
              value={prefs?.shoppingDefault ?? true}
              onValueChange={(v) => settings.setShoppingDefault.mutate(v, { onError: fail })}
            />
          </View>
          <Text style={styles.muted}>You can still change it for each post. When it’s off, posts have no tags or shop links.</Text>
          <Button label="Earnings and payouts" variant="secondary" onPress={() => router.push('/earnings')} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Finding you</Text>
          <View style={styles.row}>
            <Text style={[styles.text, styles.flex]}>Let people who have my email find me</Text>
            <Switch
              accessibilityLabel="Let people who have my email find me"
              value={prefs?.findableByEmail ?? true}
              onValueChange={(v) => settings.setFindable.mutate(v, { onError: fail })}
            />
          </View>
          <Text style={styles.muted}>
            When someone uses Find friends with their contacts and has your email address saved, you show up for them.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Who can message me</Text>
          <View style={styles.chips}>
            <Chip
              label="Everyone"
              selected={policy === 'everyone'}
              onPress={() => settings.setDmPolicy.mutate('everyone', { onError: fail })}
            />
            <Chip
              label="Connections only"
              selected={policy === 'connections'}
              onPress={() => settings.setDmPolicy.mutate('connections', { onError: fail })}
            />
          </View>
          <Text style={styles.muted}>
            {policy === 'connections'
              ? 'Only people you follow each other with, or share a group with, can message you.'
              : 'People you’re not connected with can send one message request, which waits in Requests until you accept.'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          {permission.data === 'granted' ? (
            <Text style={styles.muted}>On for this phone. Notifications say who and what, never message text.</Text>
          ) : (
            <>
              <Text style={styles.muted}>
                {permission.data === 'denied'
                  ? 'Notifications are off for Locale in your phone’s Settings.'
                  : 'Notifications are off on this phone.'}
              </Text>
              {permission.data === 'undetermined' ? (
                <Button label="Turn on notifications" variant="secondary" onPress={push.enable} loading={push.busy} />
              ) : null}
            </>
          )}
          <View style={styles.row}>
            <Text style={styles.text}>Messages and requests</Text>
            <Switch
              accessibilityLabel="Notify me about messages"
              value={prefs?.notifyMessages ?? true}
              onValueChange={(messages) => settings.setNotifications.mutate({ messages }, { onError: fail })}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.text}>Comments on my posts</Text>
            <Switch
              accessibilityLabel="Notify me about comments on my posts"
              value={prefs?.notifyComments ?? true}
              onValueChange={(comments) => settings.setNotifications.mutate({ comments }, { onError: fail })}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.text}>Price drops on my wishlist</Text>
            <Switch
              accessibilityLabel="Notify me when wishlist items drop in price or come back in stock"
              value={prefs?.notifyPriceAlerts ?? true}
              onValueChange={(priceAlerts) => settings.setNotifications.mutate({ priceAlerts }, { onError: fail })}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.text}>Sales and payouts</Text>
            <Switch
              accessibilityLabel="Notify me about sales from my posts and payouts"
              value={prefs?.notifyEarnings ?? true}
              onValueChange={(earnings) => settings.setNotifications.mutate({ earnings }, { onError: fail })}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.text}>Mentions and photo tags</Text>
            <Switch
              accessibilityLabel="Notify me when someone mentions or tags me"
              value={prefs?.notifyMentions ?? true}
              onValueChange={(mentions) => settings.setNotifications.mutate({ mentions }, { onError: fail })}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.text}>New followers</Text>
            <Switch
              accessibilityLabel="Notify me about new followers"
              value={prefs?.notifyFollows ?? true}
              onValueChange={(follows) => settings.setNotifications.mutate({ follows }, { onError: fail })}
            />
          </View>
          {LOCAL_FEATURES ? (
            <View style={styles.row}>
              <Text style={styles.text}>Group requests and approvals</Text>
              <Switch
                accessibilityLabel="Notify me about groups"
                value={prefs?.notifyGroups ?? true}
                onValueChange={(groups) => settings.setNotifications.mutate({ groups }, { onError: fail })}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Blocked accounts</Text>
          {blocked.isPending ? (
            <ActivityIndicator color={colors.accent} />
          ) : blocked.isError ? (
            <Text style={styles.muted}>Couldn’t load blocked accounts.</Text>
          ) : blocked.data.length === 0 ? (
            <Text style={styles.muted}>You haven’t blocked anyone. You can block someone from the menu on their post.</Text>
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
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  body: { padding: 16, gap: 24 },
  section: { gap: 8 },
  sectionTitle: { fontFamily: fonts.displayItalic, fontSize: 20, color: colors.ink },
  flex: { flex: 1, paddingRight: space.md },
  text: { fontFamily: fonts.body, fontSize: 16, color: colors.text },
  muted: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  chips: { flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  action: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 15, },
});
