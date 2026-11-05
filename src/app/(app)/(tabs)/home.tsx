import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, Wordmark } from '@/components/ui';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';
import type { FeedScope } from '@/features/posts/api';
import { useFeed } from '@/features/posts/hooks';
import { PostList } from '@/features/posts/PostList';
import { LOCAL_FEATURES } from '@/lib/features';
import { colors, fonts, space, type } from '@/theme';

const SCOPES: { scope: FeedScope; label: string }[] = [
  { scope: 'everywhere', label: 'For you' },
  { scope: 'following', label: 'Following' },
  ...(LOCAL_FEATURES ? [{ scope: 'nearby' as const, label: 'Nearby' }] : []),
];

export default function Home() {
  const profile = useMyProfile();
  const interests = useInterests();
  const [scope, setScope] = useState<FeedScope>('everywhere');
  const [interestId, setInterestId] = useState<number | null>(null);
  const feed = useFeed(scope, interestId);

  const myInterests = useMemo(
    () => (interests.data ?? []).filter((i) => profile.data?.interestIds.includes(i.id)),
    [interests.data, profile.data?.interestIds],
  );

  const empty = feed.isPending ? (
    <ActivityIndicator style={styles.loading} color={colors.ink} />
  ) : feed.isError ? (
    <View style={styles.empty}>
      <Text style={type.bodyMuted}>We couldn’t load the feed.</Text>
      <Button label="Try again" variant="secondary" onPress={() => feed.refetch()} />
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={type.title}>{scope === 'following' ? 'Nobody to follow yet' : 'Start the feed'}</Text>
      <Text style={type.bodyMuted}>
        {scope === 'following'
          ? 'Posts from people you follow show up here. Find people in Explore and tap Follow on their profile.'
          : scope === 'nearby'
            ? 'No posts within about 15 km yet.'
            : 'Post an outfit or a room you love and tag what’s in it, so people can shop it.'}
      </Text>
      {scope === 'following' ? (
        <Button label="Go to Explore" variant="secondary" onPress={() => router.navigate('/explore')} />
      ) : (
        <Button label="Create a post" onPress={() => router.push('/new-post')} />
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Wordmark />
      </View>
      <View style={styles.scopes} accessibilityRole="tablist">
        {SCOPES.map(({ scope: s, label }) => {
          const active = scope === s;
          return (
            <Pressable
              key={s}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setScope(s)}
              hitSlop={8}
              style={[styles.scope, active && styles.scopeActive]}
            >
              <Text style={[styles.scopeText, active && styles.scopeTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
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
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: space.lg, paddingTop: space.xs },
  scopes: {
    flexDirection: 'row',
    gap: space.xl,
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  scope: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  scopeActive: { borderBottomColor: colors.ink },
  scopeText: { fontFamily: fonts.medium, fontSize: 15, color: colors.muted },
  scopeTextActive: { fontFamily: fonts.semibold, color: colors.ink },
  filterBar: { flexGrow: 0 },
  filters: { gap: space.sm, padding: space.lg },
  loading: { marginVertical: space.xxl },
  empty: { padding: space.xl, paddingTop: 48, gap: space.lg, maxWidth: 480 },
});
