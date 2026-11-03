import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors } from '@/components/ui';
import type { Interest } from '@/features/onboarding/api';
import { timeAgo } from '@/lib/time';
import type { FeedMedia, FeedPost, Item } from './api';

type Props = {
  post: FeedPost;
  interests: Map<number, Interest>;
  onMenu: (post: FeedPost) => void;
  onOpenItem: (item: Item) => void;
};

const DOT = 26;

function TaggedPhoto({
  media,
  width,
  height,
  showTags,
  highlight,
  onToggle,
  onOpenItem,
}: {
  media: FeedMedia;
  width: number;
  height: number;
  showTags: boolean;
  highlight: string[];
  onToggle: () => void;
  onOpenItem: (item: Item) => void;
}) {
  const count = media.tags.length;
  return (
    <Pressable
      onPress={count ? onToggle : undefined}
      accessibilityRole={count ? 'button' : undefined}
      accessibilityLabel={count ? (showTags ? 'Hide tagged items' : `Show ${count} tagged items`) : undefined}
    >
      <Image
        source={media.url ? { uri: media.url, cacheKey: media.path } : undefined}
        style={{ width, height, backgroundColor: colors.chip }}
        contentFit="cover"
        transition={150}
        accessibilityIgnoresInvertColors
      />
      {showTags
        ? media.tags.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`Item: ${t.item.title}`}
              onPress={() => onOpenItem(t.item)}
              hitSlop={8}
              style={[
                styles.dot,
                highlight.includes(t.item.id) && styles.dotMatched,
                { left: t.x * width - DOT / 2, top: t.y * height - DOT / 2 },
              ]}
            >
              <View style={styles.dotInner} />
            </Pressable>
          ))
        : null}
      {count && !showTags ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{count === 1 ? '1 item' : `${count} items`}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export const PostCard = memo(function PostCard({ post, interests, onMenu, onOpenItem }: Props) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  // Search results open with their tags showing, so the match is visible.
  const [showTags, setShowTags] = useState(post.matchedItemIds.length > 0);
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
            {[`@${post.author.handle}`, post.areaName, timeAgo(post.publishedAt)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Post options" onPress={() => onMenu(post)} hitSlop={10}>
          <Text style={styles.more}>•••</Text>
        </Pressable>
      </View>

      <FlatList
        data={post.media}
        keyExtractor={(m) => m.path}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <TaggedPhoto
            media={item}
            width={width}
            height={height}
            showTags={showTags}
            highlight={post.matchedItemIds}
            onToggle={() => setShowTags((v) => !v)}
            onOpenItem={onOpenItem}
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
  more: { color: colors.muted, fontSize: 16, letterSpacing: 1 },
  pager: { alignSelf: 'center', fontSize: 12, color: colors.muted, marginTop: 6 },
  caption: { fontSize: 15, color: colors.text, lineHeight: 21, paddingHorizontal: 16, paddingTop: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotMatched: { backgroundColor: colors.accent },
  dotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  badge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  tag: { fontSize: 12, color: colors.accent, backgroundColor: colors.chip, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
});
