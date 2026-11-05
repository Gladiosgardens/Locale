import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { colors, fonts, space } from '@/theme';
import type { FeedPost } from './api';

type PagedQuery = {
  data?: { pages: FeedPost[][] };
  isRefetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  refetch: () => unknown;
  fetchNextPage: () => unknown;
};

const GAP = 3;

function Tile({ post, width, height }: { post: FeedPost; width: number; height: number }) {
  const first = post.media[0];
  const items = post.media.reduce((n, m) => n + m.tags.length, 0);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Post by ${post.author.displayName}${items ? `, ${items} shoppable items` : ''}`}
      onPress={() => router.push(`/post/${post.id}`)}
      style={({ pressed }) => [{ width, height }, pressed && styles.pressed]}
    >
      <Image
        source={first?.url ? { uri: first.url, cacheKey: first.path } : undefined}
        style={[styles.image, { width, height }]}
        contentFit="cover"
        transition={200}
        accessibilityIgnoresInvertColors
      />
      {items ? (
        <View style={styles.badge} pointerEvents="none">
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>{items}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// A grid of post thumbnails. "masonry" keeps each photo's shape in two
// columns (Explore); "square" is a three-column grid of crops (profiles).
export function PostGrid({
  query,
  layout,
  header,
  empty,
}: {
  query: PagedQuery;
  layout: 'masonry' | 'square';
  header?: ReactElement;
  empty: ReactElement;
}) {
  const [width, setWidth] = useState(0);
  const posts = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const columns = layout === 'masonry' ? 2 : 3;
  const tile = width ? (width - GAP * (columns - 1)) / columns : 0;

  // Masonry: place each post in the shorter column, so the columns stay even.
  const placed = useMemo(() => {
    const cols: { post: FeedPost; height: number }[][] = Array.from({ length: columns }, () => []);
    const heights = new Array(columns).fill(0);
    for (const post of posts) {
      const m = post.media[0];
      const ratio = m ? Math.min(Math.max(m.width / m.height, 0.66), 1.5) : 1;
      const h = tile / ratio;
      const c = heights.indexOf(Math.min(...heights));
      cols[c].push({ post, height: h });
      heights[c] += h + GAP;
    }
    return cols;
  }, [posts, columns, tile]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height > contentSize.height - 600) {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    }
  };

  return (
    <ScrollView
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onScroll={onScroll}
      scrollEventThrottle={200}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => void query.refetch()}
        />
      }
    >
      {header}
      {posts.length === 0 ? (
        empty
      ) : layout === 'square' ? (
        <View style={styles.squareGrid}>
          {posts.map((post) => (
            <Tile key={post.id} post={post} width={tile} height={tile} />
          ))}
        </View>
      ) : (
        <View style={styles.columns}>
          {placed.map((col, i) => (
            <View key={i} style={styles.column}>
              {col.map(({ post, height }) => (
                <Tile key={post.id} post={post} width={tile} height={height} />
              ))}
            </View>
          ))}
        </View>
      )}
      {query.isFetchingNextPage ? <ActivityIndicator style={styles.footer} color={colors.ink} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', gap: GAP },
  column: { flex: 1, gap: GAP },
  squareGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  image: { backgroundColor: colors.wash },
  pressed: { opacity: 0.85 },
  badge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.paper,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ultramarine },
  badgeText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.ink },
  footer: { marginVertical: space.xl },
});
