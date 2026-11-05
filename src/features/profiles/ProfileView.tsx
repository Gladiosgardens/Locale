import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, Centered } from '@/components/ui';
import { shareInvite } from '@/features/people/invite';
import { useAuthorFeed } from '@/features/posts/hooks';
import { PostGrid } from '@/features/posts/PostGrid';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, space, type } from '@/theme';
import { useFollow, useProfile } from './hooks';

// A profile: masthead name, counts, follow and message, then a grid of posts.
// Used for other people's profiles and for the Profile tab (where `isTab` hides Back).
export function ProfileView({ id, isTab }: { id: string | undefined; isTab?: boolean }) {
  const profile = useProfile(id);
  const posts = useAuthorFeed(id);
  const follow = useFollow(id);
  const p = profile.data;

  if (profile.isPending) {
    return (
      <Centered>
        <ActivityIndicator color={colors.ink} />
      </Centered>
    );
  }
  if (!p) {
    return (
      <Centered>
        <Text style={type.bodyMuted}>
          {profile.isError ? 'We couldn’t load this profile.' : 'This profile isn’t available.'}
        </Text>
        {profile.isError ? (
          <Button label="Try again" variant="secondary" onPress={() => profile.refetch()} />
        ) : !isTab ? (
          <Button label="Back" variant="secondary" onPress={() => router.back()} />
        ) : null}
      </Centered>
    );
  }

  const postCount = posts.data?.pages.flat().length ?? 0;
  const morePosts = posts.hasNextPage;

  const header = (
    <View style={styles.info}>
      <View style={styles.identity}>
        <Avatar name={p.displayName} size={76} />
        <View style={styles.counts}>
          <Stat value={morePosts ? `${postCount}+` : String(postCount)} label={postCount === 1 ? 'post' : 'posts'} />
          <Stat value={p.followerCount.toLocaleString()} label={p.followerCount === 1 ? 'follower' : 'followers'} />
          <Stat value={p.followingCount.toLocaleString()} label="following" />
        </View>
      </View>
      <View style={styles.names}>
        <Text style={styles.name} accessibilityRole="header">
          {p.displayName}
        </Text>
        <Text style={type.small}>
          @{p.handle}
          {p.followsMe && !p.isMe ? ', follows you' : ''}
        </Text>
      </View>
      {p.bio ? <Text style={type.body}>{p.bio}</Text> : null}
      {p.isMe ? (
        <View style={styles.actions}>
          <Button style={styles.flex} label="Find friends" onPress={() => router.push('/find-friends')} />
          <Button style={styles.flex} label="Share profile" variant="quiet" onPress={() => void shareInvite(p.handle)} />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            style={styles.flex}
            label={p.iFollow ? 'Following' : 'Follow'}
            variant={p.iFollow ? 'quiet' : 'primary'}
            onPress={() => follow.mutate(!p.iFollow, { onError: (e) => Alert.alert(friendlyError(e)) })}
          />
          <Button
            style={styles.flex}
            label="Message"
            variant="secondary"
            onPress={() => router.push({ pathname: '/messages/new', params: { to: p.id, name: p.displayName } })}
          />
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        {isTab ? null : (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
            <Feather name="arrow-left" size={24} color={colors.ink} />
          </Pressable>
        )}
        <Text style={styles.topHandle} numberOfLines={1}>
          {p.handle}
        </Text>
        {isTab ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/settings')} hitSlop={10}>
            <Feather name="settings" size={22} color={colors.ink} />
          </Pressable>
        ) : (
          <View style={styles.spacer} />
        )}
      </View>
      <PostGrid
        query={posts}
        layout="square"
        header={header}
        empty={
          posts.isPending ? (
            <ActivityIndicator style={styles.loading} color={colors.ink} />
          ) : (
            <View style={styles.empty}>
              <Text style={type.bodyMuted}>{p.isMe ? 'Your posts will appear here.' : 'No posts yet.'}</Text>
              {p.isMe ? <Button label="Create a post" onPress={() => router.push('/new-post')} /> : null}
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  topHandle: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  spacer: { width: 24 },
  info: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xl, gap: space.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
  counts: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  statValue: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  statLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  names: { gap: 2 },
  name: { ...type.title, fontSize: 26, lineHeight: 30 },
  actions: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  loading: { marginVertical: space.xl },
  empty: { padding: space.xl, gap: space.lg, alignItems: 'flex-start' },
});
