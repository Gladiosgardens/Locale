import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { useFilteredFeed } from '@/features/posts/hooks';
import { PostList } from '@/features/posts/PostList';
import { colors, space, type } from '@/theme';

// Posts with one hashtag, newest first.
export default function HashtagScreen() {
  const { tag: raw } = useLocalSearchParams<{ tag: string }>();
  const tag = (raw ?? '').replace(/^#/, '').toLowerCase();
  const filter = useMemo(() => (tag ? { hashtag: tag } : null), [tag]);
  const feed = useFilteredFeed(filter);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header" numberOfLines={1}>
          #{tag}
        </Text>
      </View>
      <PostList
        query={feed}
        empty={
          feed.isPending ? (
            <ActivityIndicator style={styles.loading} color={colors.ink} />
          ) : feed.isError ? (
            <View style={styles.empty}>
              <Text style={type.bodyMuted}>We couldn’t load these posts.</Text>
              <Button label="Try again" variant="secondary" onPress={() => feed.refetch()} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={type.bodyMuted}>No posts with #{tag} yet. Add it to a caption to start it.</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  loading: { marginVertical: space.xl },
  empty: { padding: space.xl, gap: space.md },
});
