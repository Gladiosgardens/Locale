import { router } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { colors } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { ItemSheet } from '@/features/items/ItemSheet';
import { ReportSheet, type ReportSubject } from '@/features/safety/ReportSheet';
import { StoryShareSheet } from '@/features/share/StoryShareSheet';
import { useBlockUser } from '@/features/safety/hooks';
import { useInterests } from '@/features/onboarding/hooks';
import { friendlyError } from '@/lib/errors';
import type { FeedPost, Item } from './api';
import { EditCaptionSheet } from './EditCaptionSheet';
import { useDeletePost } from './hooks';
import { PostActions, type PostAction } from './PostActions';
import { PostCard } from './PostCard';

const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

type PagedQuery = {
  data?: { pages: FeedPost[][] };
  isRefetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  refetch: () => unknown;
  fetchNextPage: () => unknown;
};

// Shared by the Nearby and Everywhere feeds and by search.
export function PostList({ query, empty, header }: { query: PagedQuery; empty: ReactElement; header?: ReactElement }) {
  const { session } = useAuth();
  const interests = useInterests();
  const remove = useDeletePost();
  const block = useBlockUser();
  const [openItem, setOpenItem] = useState<{ item: Item; postId: string } | null>(null);
  const [menuPost, setMenuPost] = useState<FeedPost | null>(null);
  const [reporting, setReporting] = useState<ReportSubject | null>(null);
  const [storyPost, setStoryPost] = useState<FeedPost | null>(null);
  const [editing, setEditing] = useState<FeedPost | null>(null);
  // The post most on screen; its video (if any) plays.
  const [activeId, setActiveId] = useState<string | null>(null);
  // FlatList needs this callback to stay the same for the list's lifetime.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: { item: FeedPost; isViewable: boolean }[] }) => {
    setActiveId(viewableItems.find((v) => v.isViewable)?.item.id ?? null);
  }, []);

  const interestMap = useMemo(() => new Map((interests.data ?? []).map((i) => [i.id, i])), [interests.data]);
  const posts = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);

  function onPick(action: PostAction, post: FeedPost) {
    const fail = (e: unknown) => Alert.alert(friendlyError(e));
    switch (action) {
      case 'edit':
        return setEditing(post);
      case 'story':
        return setStoryPost(post);
      case 'share':
        return router.push({ pathname: '/messages/share', params: { postId: post.id } });
      case 'delete':
        return Alert.alert('Delete this post?', 'It will disappear for everyone right away.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(post.id, { onError: fail }) },
        ]);
      case 'report-post':
        return setReporting({ type: 'post', id: post.id, label: 'post' });
      case 'report-user':
        return setReporting({ type: 'profile', id: post.author.id, label: `@${post.author.handle}` });
      case 'block':
        return Alert.alert(
          `Block @${post.author.handle}?`,
          'You won’t see each other’s posts or profiles. They won’t be told. You can unblock in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Block', style: 'destructive', onPress: () => block.mutate(post.author.id, { onError: fail }) },
          ],
        );
    }
  }

  const openItemSheet = useCallback((item: Item, postId: string) => setOpenItem({ item, postId }), []);

  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => (
      <PostCard
        post={item}
        interests={interestMap}
        onMenu={setMenuPost}
        onOpenItem={openItemSheet}
        onShare={setStoryPost}
        active={item.id === activeId}
      />
    ),
    [interestMap, openItemSheet, activeId],
  );

  return (
    <>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        onViewableItemsChanged={onViewable}
        viewabilityConfig={VIEWABILITY}
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
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
      />
      <ItemSheet item={openItem?.item ?? null} postId={openItem?.postId} onClose={() => setOpenItem(null)} />
      <PostActions
        post={menuPost}
        isMine={menuPost?.author.id === session?.user.id}
        onPick={onPick}
        onClose={() => setMenuPost(null)}
      />
      <ReportSheet subject={reporting} onClose={() => setReporting(null)} />
      <EditCaptionSheet post={editing} onClose={() => setEditing(null)} />
      <StoryShareSheet post={storyPost} interests={interestMap} onClose={() => setStoryPost(null)} />
    </>
  );
}

const styles = StyleSheet.create({ footer: { marginVertical: 24 } });
