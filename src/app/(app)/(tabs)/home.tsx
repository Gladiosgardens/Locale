import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, Wordmark } from '@/components/ui';
import { useActivityUnread } from '@/features/activity/hooks';
import { useAuth } from '@/features/auth/AuthProvider';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';
import type { FeedScope } from '@/features/posts/api';
import { useFeed } from '@/features/posts/hooks';
import { PostList } from '@/features/posts/PostList';
import { useProfile } from '@/features/profiles/hooks';
import { StoryTray } from '@/features/stories/StoryTray';
import { LOCAL_FEATURES } from '@/lib/features';
import { colors, fonts, radius, space, type } from '@/theme';

const SCOPES: { scope: FeedScope; label: string }[] = [
  { scope: 'for-you', label: 'For you' },
  { scope: 'following', label: 'Following' },
  ...(LOCAL_FEATURES ? [{ scope: 'nearby' as const, label: 'Nearby' }] : []),
];

export default function Home() {
  const profile = useMyProfile();
  const interests = useInterests();
  const [scope, setScope] = useState<FeedScope>('for-you');
  const [interestId, setInterestId] = useState<number | null>(null);
  const feed = useFeed(scope, interestId);
  const unread = useActivityUnread();
  const { session } = useAuth();
  const me = useProfile(session?.user.id);
  const [hideInvite, setHideInvite] = useState(false);
  const followsNobody = me.data?.followingCount === 0;

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
          ? 'Posts from people you follow show up here. Find your friends by name, from your contacts or with an invite link.'
          : scope === 'nearby'
            ? 'No posts within about 15 km yet.'
            : 'Share a moment, an outfit or a room you love. Tag what’s in it so people can find it.'}
      </Text>
      {scope === 'following' ? (
        <Button label="Find friends" onPress={() => router.push('/find-friends')} />
      ) : (
        <Button label="Create a post" onPress={() => router.push('/new-post')} />
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Wordmark />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unread.data ? `Activity, ${unread.data} new` : 'Activity'}
          onPress={() => router.push('/activity')}
          hitSlop={10}
        >
          <Feather name="heart" size={24} color={colors.ink} />
          {unread.data ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread.data > 9 ? '9+' : unread.data}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <StoryTray />
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

      <PostList
        query={feed}
        empty={empty}
        header={
          followsNobody && !hideInvite && scope !== 'following' ? (
            <View style={styles.invite}>
              <View style={styles.inviteText}>
                <Text style={styles.inviteTitle}>Find your friends</Text>
                <Text style={type.small}>Follow people you know to see their posts in Following.</Text>
              </View>
              <Button label="Find" style={styles.inviteButton} onPress={() => router.push('/find-friends')} />
              <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setHideInvite(true)} hitSlop={10}>
                <Feather name="x" size={18} color={colors.muted} />
              </Pressable>
            </View>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.ultramarine,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.paper,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, color: colors.onInk },
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
  invite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    margin: space.lg,
    padding: space.lg,
    backgroundColor: colors.wash,
    borderRadius: radius.tag,
  },
  inviteText: { flex: 1, gap: 2 },
  inviteTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  inviteButton: { paddingVertical: 9, paddingHorizontal: space.lg },
});
