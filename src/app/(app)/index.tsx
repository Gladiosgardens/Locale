import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, colors } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { signOut } from '@/features/auth/api';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';
import type { FeedPost } from '@/features/posts/api';
import { useDeletePost, useFeed } from '@/features/posts/hooks';
import { PostCard } from '@/features/posts/PostCard';
import { friendlyError } from '@/lib/errors';

export default function Feed() {
  const { session } = useAuth();
  const profile = useMyProfile();
  const interests = useInterests();
  const [interestId, setInterestId] = useState<number | null>(null);
  const feed = useFeed(interestId);
  const remove = useDeletePost();

  const interestMap = useMemo(() => new Map((interests.data ?? []).map((i) => [i.id, i])), [interests.data]);
  const myInterests = useMemo(
    () => (interests.data ?? []).filter((i) => profile.data?.interestIds.includes(i.id)),
    [interests.data, profile.data?.interestIds],
  );
  const posts = useMemo(() => feed.data?.pages.flat() ?? [], [feed.data]);
  const filterLabel = interestId ? interestMap.get(interestId)?.label : null;

  const confirmDelete = useCallback(
    (post: FeedPost) =>
      Alert.alert('Delete this post?', 'It will disappear for everyone right away.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => remove.mutate(post.id, { onError: (e) => Alert.alert(friendlyError(e)) }),
        },
      ]),
    [remove],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => (
      <PostCard post={item} interests={interestMap} isMine={item.author.id === session?.user.id} onDelete={confirmDelete} />
    ),
    [interestMap, session?.user.id, confirmDelete],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} accessibilityRole="header">Nearby</Text>
          {profile.data?.area ? <Text style={styles.subtitle}>{profile.data.area.name} and around</Text> : null}
        </View>
        <Pressable accessibilityRole="button" onPress={signOut} hitSlop={8}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.newPost} onPress={() => router.push('/new-post')}>
          <Text style={styles.newPostText}>New post</Text>
        </Pressable>
      </View>

      {myInterests.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} style={styles.filterBar}>
          <Chip label="All" selected={interestId === null} onPress={() => setInterestId(null)} />
          {myInterests.map((i) => (
            <Chip key={i.id} label={i.label} selected={interestId === i.id} onPress={() => setInterestId(i.id)} />
          ))}
        </ScrollView>
      ) : null}

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching && !feed.isFetchingNextPage} onRefresh={() => void feed.refetch()} />
        }
        ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator style={styles.footer} color={colors.accent} /> : undefined}
        ListEmptyComponent={
          feed.isPending ? (
            <ActivityIndicator style={styles.footer} color={colors.accent} />
          ) : feed.isError ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>We couldn’t load the feed.</Text>
              <Button label="Try again" variant="secondary" onPress={() => feed.refetch()} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {filterLabel
                  ? `No ${filterLabel} posts within about 15 km yet.`
                  : 'No posts within about 15 km yet. Be the first to share something.'}
              </Text>
              <Button label="Create a post" onPress={() => router.push('/new-post')} />
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  headerText: { flex: 1 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 2 },
  link: { color: colors.muted, fontSize: 14 },
  newPost: { backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  newPostText: { color: colors.accentText, fontWeight: '600', fontSize: 14 },
  filterBar: { flexGrow: 0 },
  filters: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  footer: { marginVertical: 24 },
  empty: { padding: 24, gap: 16 },
  emptyText: { fontSize: 16, color: colors.muted, lineHeight: 22 },
});
