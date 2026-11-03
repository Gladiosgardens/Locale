import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, colors } from '@/components/ui';
import { signOut } from '@/features/auth/api';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';
import type { FeedScope } from '@/features/posts/api';
import { useFeed } from '@/features/posts/hooks';
import { PostList } from '@/features/posts/PostList';

export default function Feed() {
  const profile = useMyProfile();
  const interests = useInterests();
  const [scope, setScope] = useState<FeedScope>('nearby');
  const [interestId, setInterestId] = useState<number | null>(null);
  const feed = useFeed(scope, interestId);

  const myInterests = useMemo(
    () => (interests.data ?? []).filter((i) => profile.data?.interestIds.includes(i.id)),
    [interests.data, profile.data?.interestIds],
  );
  const filterLabel = interestId ? myInterests.find((i) => i.id === interestId)?.label : null;

  const empty = feed.isPending ? (
    <ActivityIndicator style={styles.loading} color={colors.accent} />
  ) : feed.isError ? (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>We couldn’t load the feed.</Text>
      <Button label="Try again" variant="secondary" onPress={() => feed.refetch()} />
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>
        {scope === 'everywhere'
          ? 'Nothing here yet. Public posts from everywhere will show up here.'
          : filterLabel
            ? `No ${filterLabel} posts within about 15 km yet.`
            : 'No posts within about 15 km yet. Be the first to share something.'}
      </Text>
      <Button label="Create a post" onPress={() => router.push('/new-post')} />
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {(['nearby', 'everywhere'] as const).map((s) => (
            <Pressable
              key={s}
              accessibilityRole="tab"
              accessibilityState={{ selected: scope === s }}
              onPress={() => setScope(s)}
              hitSlop={6}
            >
              <Text style={[styles.tab, scope === s && styles.tabActive]}>
                {s === 'nearby' ? 'Nearby' : 'Everywhere'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.push('/groups')} hitSlop={8}>
          <Text style={styles.link}>Groups</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/search')} hitSlop={8}>
          <Text style={styles.link}>Search</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.newPost} onPress={() => router.push('/new-post')}>
          <Text style={styles.newPostText}>New post</Text>
        </Pressable>
      </View>
      <View style={styles.subheader}>
        <Text style={styles.subtitle}>
          {scope === 'nearby'
            ? profile.data?.area
              ? `${profile.data.area.name} and around`
              : 'Around you'
            : 'Public posts from everywhere'}
        </Text>
        <Pressable accessibilityRole="button" onPress={signOut} hitSlop={8}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>

      {scope === 'nearby' && myInterests.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} style={styles.filterBar}>
          <Chip label="All" selected={interestId === null} onPress={() => setInterestId(null)} />
          {myInterests.map((i) => (
            <Chip key={i.id} label={i.label} selected={interestId === i.id} onPress={() => setInterestId(i.id)} />
          ))}
        </ScrollView>
      ) : null}

      <PostList query={feed} empty={empty} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 8 },
  tabs: { flex: 1, flexDirection: 'row', gap: 16 },
  tab: { fontSize: 22, fontWeight: '700', color: colors.border },
  tabActive: { color: colors.text },
  subheader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10 },
  subtitle: { flex: 1, fontSize: 14, color: colors.muted },
  link: { color: colors.muted, fontSize: 14 },
  newPost: { backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  newPostText: { color: colors.accentText, fontWeight: '600', fontSize: 14 },
  filterBar: { flexGrow: 0 },
  filters: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  loading: { marginVertical: 24 },
  empty: { padding: 24, gap: 16 },
  emptyText: { fontSize: 16, color: colors.muted, lineHeight: 22 },
});
