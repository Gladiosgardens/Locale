import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { colors } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { ItemSheet } from '@/features/items/ItemSheet';
import { useInterests } from '@/features/onboarding/hooks';
import { friendlyError } from '@/lib/errors';
import type { FeedPost, Item } from './api';
import { useDeletePost } from './hooks';
import { PostCard } from './PostCard';

type PagedQuery = {
  data?: { pages: FeedPost[][] };
  isRefetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  refetch: () => unknown;
  fetchNextPage: () => unknown;
};

// Shared by the Nearby and Everywhere feeds and by search.
export function PostList({ query, empty }: { query: PagedQuery; empty: ReactElement }) {
  const { session } = useAuth();
  const interests = useInterests();
  const remove = useDeletePost();
  const [openItem, setOpenItem] = useState<Item | null>(null);

  const interestMap = useMemo(() => new Map((interests.data ?? []).map((i) => [i.id, i])), [interests.data]);
  const posts = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);

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
      <PostCard
        post={item}
        interests={interestMap}
        isMine={item.author.id === session?.user.id}
        onDelete={confirmDelete}
        onOpenItem={setOpenItem}
      />
    ),
    [interestMap, session?.user.id, confirmDelete],
  );

  return (
    <>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isFetchingNextPage}
            onRefresh={() => void query.refetch()}
          />
        }
        ListFooterComponent={
          query.isFetchingNextPage ? <ActivityIndicator style={styles.footer} color={colors.accent} /> : undefined
        }
        ListEmptyComponent={empty}
      />
      <ItemSheet item={openItem} onClose={() => setOpenItem(null)} />
    </>
  );
}

const styles = StyleSheet.create({ footer: { marginVertical: 24 } });
