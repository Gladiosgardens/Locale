import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Avatar } from '@/components/ui';
import { ShopTheLook } from '@/features/items/HangTag';
import type { Interest } from '@/features/onboarding/api';
import { timeAgo } from '@/lib/time';
import { colors, fonts, space } from '@/theme';
import type { FeedMedia, FeedPost, Item } from './api';

type Props = {
  post: FeedPost;
  interests: Map<number, Interest>;
  onMenu: (post: FeedPost) => void;
  onOpenItem: (item: Item) => void;
};

const DOT = 22;
// Wide enough for a phone, never so wide on web/tablet that photos get blurry or huge.
const MAX_WIDTH = 560;

function TaggedPhoto({
  media,
  width,
  height,
  showTags,
  numbers,
  highlight,
  onToggle,
  onOpenItem,
}: {
  media: FeedMedia;
  width: number;
  height: number;
  showTags: boolean;
  numbers: Map<string, number>;
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
        style={{ width, height, backgroundColor: colors.wash }}
        contentFit="cover"
        transition={200}
        accessibilityIgnoresInvertColors
      />
      {showTags
        ? media.tags.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`Item: ${t.item.title}`}
              onPress={() => onOpenItem(t.item)}
              hitSlop={10}
              style={[
                styles.dot,
                highlight.includes(t.item.id) && styles.dotMatched,
                { left: t.x * width - DOT / 2, top: t.y * height - DOT / 2 },
              ]}
            >
              <Text style={[styles.dotText, highlight.includes(t.item.id) && styles.dotTextMatched]}>
                {numbers.get(t.item.id)}
              </Text>
            </Pressable>
          ))
        : null}
      {count && !showTags ? (
        <View style={styles.badge} pointerEvents="none">
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>{count === 1 ? '1 item' : `${count} items`}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export const PostCard = memo(function PostCard({ post, interests, onMenu, onOpenItem }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth, MAX_WIDTH);
  const [page, setPage] = useState(0);
  // Search results open with their tags showing, so the match is visible.
  const [showTags, setShowTags] = useState(post.matchedItemIds.length > 0);
  const first = post.media[0];
  // Keep cards within portrait 4:5 and landscape 1.91:1, like other photo apps.
  const ratio = first ? Math.min(Math.max(first.width / first.height, 0.8), 1.91) : 1;
  const height = Math.round(width / ratio);

  // Every distinct item across the post's photos, numbered in order of appearance.
  const items = useMemo(() => {
    const seen = new Map<string, Item>();
    for (const m of post.media) for (const t of m.tags) if (!seen.has(t.item.id)) seen.set(t.item.id, t.item);
    return [...seen.values()];
  }, [post.media]);
  const numbers = useMemo(() => new Map(items.map((it, i) => [it.id, i + 1])), [items]);
  const meta = [post.areaName, timeAgo(post.publishedAt)].filter(Boolean).join(', ');

  return (
    <View style={[styles.card, { width }]} accessibilityLabel={`Post by ${post.author.displayName}`}>
      <View style={styles.header}>
        <Pressable
          style={styles.author}
          accessibilityRole="link"
          accessibilityLabel={`Open ${post.author.displayName}’s profile`}
          onPress={() => router.push(`/profile/${post.author.id}`)}
        >
          <Avatar name={post.author.displayName} size={34} />
          <View style={styles.authorText}>
            <Text style={styles.name} numberOfLines={1}>
              {post.author.displayName}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              @{post.author.handle}
            </Text>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Post options" onPress={() => onMenu(post)} hitSlop={12}>
          <View style={styles.more}>
            <View style={styles.moreDot} />
            <View style={styles.moreDot} />
            <View style={styles.moreDot} />
          </View>
        </Pressable>
      </View>

      <View>
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
              numbers={numbers}
              highlight={post.matchedItemIds}
              onToggle={() => setShowTags((v) => !v)}
              onOpenItem={onOpenItem}
            />
          )}
        />
        {post.media.length > 1 ? (
          <View style={styles.pager} pointerEvents="none" accessibilityLabel={`Photo ${page + 1} of ${post.media.length}`}>
            {post.media.map((m, i) => (
              <View key={m.path} style={[styles.pagerDot, i === page && styles.pagerDotActive]} />
            ))}
          </View>
        ) : null}
      </View>

      <ShopTheLook
        items={items}
        highlight={post.matchedItemIds}
        onOpen={onOpenItem}
        title={post.interestIds.some((id) => interests.get(id)?.section === 'style') ? 'Shop the look' : 'Shop this'}
      />

      <View style={styles.footer}>
        {post.caption ? (
          <Text style={styles.caption}>
            <Text style={styles.captionName}>{post.author.handle} </Text>
            {post.caption}
          </Text>
        ) : null}
        {post.interestIds.length ? (
          <View style={styles.interests}>
            {post.interestIds.map((id) => (
              <Text key={id} style={styles.interest}>
                {interests.get(id)?.label ?? 'Interest'}
              </Text>
            ))}
          </View>
        ) : null}
        <Text style={styles.time}>{meta}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: colors.paper, alignSelf: 'center', paddingBottom: space.xl },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md },
  author: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  authorText: { flex: 1 },
  name: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  more: { flexDirection: 'row', gap: 3, padding: 4 },
  moreDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.ink },
  pager: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  pagerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  pagerDotActive: { backgroundColor: colors.paper },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, gap: 6 },
  caption: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  captionName: { fontFamily: fonts.semibold },
  interests: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  interest: { fontFamily: fonts.medium, fontSize: 13, color: colors.graphite, textDecorationLine: 'underline' },
  time: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  dotMatched: { backgroundColor: colors.ultramarine },
  dotText: { fontFamily: fonts.bold, fontSize: 11, color: colors.ink },
  dotTextMatched: { color: colors.paper },
  badge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.paper,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ultramarine },
  badgeText: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 12 },
});
