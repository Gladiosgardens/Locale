import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Centered, colors } from '@/components/ui';
import { useAuthorFeed } from '@/features/posts/hooks';
import { PostList } from '@/features/posts/PostList';
import { useFollow, useProfile } from '@/features/profiles/hooks';
import { friendlyError } from '@/lib/errors';

export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useProfile(id);
  const posts = useAuthorFeed(id);
  const follow = useFollow(id);
  const p = profile.data;

  if (profile.isPending) {
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  }
  if (!p) {
    return (
      <Centered>
        <Text style={styles.muted}>{profile.isError ? 'We couldn’t load this profile.' : 'This profile isn’t available.'}</Text>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </Centered>
    );
  }

  const header = (
    <View style={styles.info}>
      <Text style={styles.name} accessibilityRole="header">{p.displayName}</Text>
      <Text style={styles.muted}>
        @{p.handle}
        {p.followsMe && !p.isMe ? '  ·  Follows you' : ''}
      </Text>
      {p.bio ? <Text style={styles.bio}>{p.bio}</Text> : null}
      <Text style={styles.counts}>
        <Text style={styles.count}>{p.followerCount}</Text> {p.followerCount === 1 ? 'follower' : 'followers'}
        {'   '}
        <Text style={styles.count}>{p.followingCount}</Text> following
      </Text>
      {!p.isMe ? (
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button
              label={p.iFollow ? 'Following' : 'Follow'}
              variant={p.iFollow ? 'secondary' : 'primary'}
              onPress={() => follow.mutate(!p.iFollow, { onError: (e) => Alert.alert(friendlyError(e)) })}
            />
          </View>
          <View style={styles.flex}>
            <Button
              label="Message"
              variant="secondary"
              onPress={() => router.push({ pathname: '/messages/new', params: { to: p.id, name: p.displayName } })}
            />
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </View>
      <PostList
        query={posts}
        header={header}
        empty={
          posts.isPending ? (
            <ActivityIndicator style={styles.loading} color={colors.accent} />
          ) : (
            <Text style={styles.empty}>{p.isMe ? 'You haven’t posted yet.' : 'No posts you can see yet.'}</Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topbar: { paddingHorizontal: 16, paddingVertical: 8 },
  link: { color: colors.muted, fontSize: 15 },
  info: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  name: { fontSize: 24, fontWeight: '700', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  bio: { fontSize: 15, color: colors.text, lineHeight: 21 },
  counts: { fontSize: 14, color: colors.muted },
  count: { fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1 },
  loading: { marginVertical: 24 },
  empty: { padding: 16, fontSize: 15, color: colors.muted },
});
