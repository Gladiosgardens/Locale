import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { usePost } from '@/features/posts/hooks';
import { formatUsd } from '@/features/earnings/api';
import { usePostEarnings } from '@/features/earnings/hooks';
import { usePostStats } from '@/features/stats/hooks';
import { StatTile } from '@/features/stats/Stat';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/time';
import { colors, fonts, radius, space, type } from '@/theme';

// One post's numbers, down to each tagged item.
export default function PostInsights() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const stats = usePostStats(postId);
  const post = usePost(postId);
  const s = stats.data;
  const earned = usePostEarnings(postId);
  const media = post.data?.media[0];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Post insights
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {post.data ? (
          <Pressable accessibilityRole="link" onPress={() => router.push(`/post/${postId}`)} style={styles.head}>
            <Image source={media?.url ? { uri: media.url } : undefined} style={styles.thumb} contentFit="cover" />
            <View style={styles.headText}>
              <Text style={styles.caption} numberOfLines={2}>
                {post.data.caption || 'Untitled post'}
              </Text>
              <Text style={styles.meta}>Posted {timeAgo(post.data.publishedAt)}</Text>
            </View>
          </Pressable>
        ) : null}

        {stats.isPending ? <ActivityIndicator style={styles.loading} color={colors.ink} /> : null}
        {stats.isError ? (
          <View style={styles.empty}>
            <Text style={type.bodyMuted}>{friendlyError(stats.error)}</Text>
            <Button label="Try again" variant="secondary" onPress={() => stats.refetch()} />
          </View>
        ) : null}

        {s ? (
          <>
            <View style={styles.grid}>
              <StatTile value={s.reach} label="accounts reached" />
              <StatTile value={s.views} label="views" />
              <StatTile value={s.likes} label="likes" />
              <StatTile value={s.comments} label="comments" />
              <StatTile value={s.saves} label="saves" />
            </View>

            {s.items.length ? (
              <>
                <Text style={styles.section}>Tagged items</Text>
                <View style={styles.grid}>
                  <StatTile value={s.itemOpens} label="people viewed items" shop />
                  <StatTile value={s.linkTaps} label="people tapped to shops" shop />
                  <StatTile value={earned.data?.sales ?? 0} label="sales" shop />
                  <View style={styles.earnedTile} accessible accessibilityLabel={`${formatUsd(earned.data?.earnedCents ?? 0)} earned`}>
                    <Text style={styles.earnedValue}>{formatUsd(earned.data?.earnedCents ?? 0)}</Text>
                    <Text style={styles.meta}>you earned</Text>
                  </View>
                </View>
                {s.items.map((it) => (
                  <View
                    key={it.itemId}
                    style={styles.item}
                    accessible
                    accessibilityLabel={`${it.title}: ${it.opens} views, ${it.linkTaps} taps to shop, ${it.wishlist} wishlist saves`}
                  >
                    <View style={styles.dot} />
                    <View style={styles.itemText}>
                      <Text style={styles.itemTitle} numberOfLines={1}>
                        {it.title}
                      </Text>
                      <Text style={styles.meta}>
                        {it.opens} {it.opens === 1 ? 'view' : 'views'}
                        {it.urlHost ? `, ${it.linkTaps} ${it.linkTaps === 1 ? 'tap' : 'taps'} to ${it.urlHost}` : ', no link'}
                        {it.wishlist ? `, ${it.wishlist} on wishlists` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            ) : (
              <Text style={styles.note}>Tag what’s in your photos to see how many people look at each item and tap through to shops.</Text>
            )}
            <Text style={styles.note}>
              Reach is how many people saw this post; views counts repeat visits. Your own views and taps aren’t counted, and
              only you can see these numbers.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  body: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: space.md },
  thumb: { width: 64, height: 64, borderRadius: radius.tag, backgroundColor: colors.wash },
  headText: { flex: 1, gap: 2 },
  caption: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  loading: { marginVertical: space.xl },
  empty: { gap: space.md, paddingVertical: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  section: {
    fontFamily: fonts.displayItalic,
    fontSize: 19,
    color: colors.ink,
    marginTop: space.lg,
    paddingBottom: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  earnedTile: { width: '50%', paddingVertical: 14, gap: 2 },
  earnedValue: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, color: colors.ultramarine },
  item: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.ultramarine },
  itemText: { flex: 1, gap: 2 },
  itemTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: space.xl },
});
