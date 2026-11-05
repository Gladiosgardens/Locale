import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { usePost } from '@/features/posts/hooks';
import { PostList } from '@/features/posts/PostList';
import { colors, space, type } from '@/theme';

// One post on its own, opened from a grid (Explore, profiles) or a shared link.
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const post = usePost(id);
  // PostList expects pages; one post is one page with no more to load.
  const query = {
    data: post.data ? { pages: [[post.data]] } : undefined,
    isRefetching: post.isRefetching,
    isFetchingNextPage: false,
    hasNextPage: false,
    refetch: post.refetch,
    fetchNextPage: () => undefined,
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
      </View>
      <PostList
        query={query}
        empty={
          post.isPending ? (
            <ActivityIndicator style={styles.loading} color={colors.ink} />
          ) : (
            <View style={styles.empty}>
              <Text style={type.bodyMuted}>
                {post.isError ? 'We couldn’t load this post.' : 'This post isn’t available anymore.'}
              </Text>
              {post.isError ? <Button label="Try again" variant="secondary" onPress={() => post.refetch()} /> : null}
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  loading: { marginVertical: space.xxl },
  empty: { padding: space.xl, gap: space.md },
});
