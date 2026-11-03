import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors } from '@/components/ui';
import type { Interest } from '@/features/onboarding/api';
import { timeAgo } from '@/lib/time';
import type { FeedPost } from './api';

type Props = {
  post: FeedPost;
  interests: Map<number, Interest>;
  isMine: boolean;
  onDelete: (post: FeedPost) => void;
};

export const PostCard = memo(function PostCard({ post, interests, isMine, onDelete }: Props) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const first = post.media[0];
  // Keep cards within portrait 4:5 and landscape 1.91:1, like other photo apps.
  const ratio = first ? Math.min(Math.max(first.width / first.height, 0.8), 1.91) : 1;
  const height = Math.round(width / ratio);

  return (
    <View style={styles.card} accessibilityLabel={`Post by ${post.author.displayName}`}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.name}>{post.author.displayName}</Text>
          <Text style={styles.meta}>
            @{post.author.handle} · {post.areaName} · {timeAgo(post.publishedAt)}
          </Text>
        </View>
        {isMine ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Delete post" onPress={() => onDelete(post)} hitSlop={10}>
            <Text style={styles.delete}>Delete</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={post.media}
        keyExtractor={(m) => m.path}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <Image
            source={item.url ? { uri: item.url, cacheKey: item.path } : undefined}
            style={{ width, height, backgroundColor: colors.chip }}
            contentFit="cover"
            transition={150}
            accessibilityIgnoresInvertColors
          />
        )}
      />
      {post.media.length > 1 ? (
        <Text style={styles.pager}>
          {page + 1}/{post.media.length}
        </Text>
      ) : null}

      {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}
      {post.interestIds.length ? (
        <View style={styles.tags}>
          {post.interestIds.map((id) => (
            <Text key={id} style={styles.tag}>
              {interests.get(id)?.label ?? 'Interest'}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  delete: { color: colors.danger, fontSize: 14 },
  pager: { alignSelf: 'center', fontSize: 12, color: colors.muted, marginTop: 6 },
  caption: { fontSize: 15, color: colors.text, lineHeight: 21, paddingHorizontal: 16, paddingTop: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  tag: { fontSize: 12, color: colors.accent, backgroundColor: colors.chip, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
});
