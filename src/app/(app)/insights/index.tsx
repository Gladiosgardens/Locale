import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { usePost } from '@/features/posts/hooks';
import { formatUsd } from '@/features/earnings/api';
import { useEarnings } from '@/features/earnings/hooks';
import { useSummary } from '@/features/stats/hooks';
import { StatTile } from '@/features/stats/Stat';
import { colors, fonts, radius, space, type } from '@/theme';

const PERIODS = [7, 30, 90] as const;

// What happened across my posts recently: reach, engagement and shopping.
export default function Insights() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const summary = useSummary(days);
  const s = summary.data;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Insights
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.periods} accessibilityRole="tablist">
          {PERIODS.map((d) => (
            <Pressable
              key={d}
              accessibilityRole="tab"
              accessibilityState={{ selected: days === d }}
              onPress={() => setDays(d)}
              style={[styles.period, days === d && styles.periodActive]}
            >
              <Text style={[styles.periodText, days === d && styles.periodTextActive]}>Last {d} days</Text>
            </Pressable>
          ))}
        </View>

        <EarningsCard />
        {summary.isPending ? <ActivityIndicator style={styles.loading} color={colors.ink} /> : null}
        {summary.isError ? (
          <View style={styles.empty}>
            <Text style={type.bodyMuted}>We couldn’t load your insights.</Text>
            <Button label="Try again" variant="secondary" onPress={() => summary.refetch()} />
          </View>
        ) : null}

        {s ? (
          <>
            <Text style={styles.section}>Reach</Text>
            <View style={styles.grid}>
              <StatTile value={s.reach} label="accounts reached" />
              <StatTile value={s.newFollowers} label="new followers" />
            </View>
            <Text style={styles.section}>Shopping</Text>
            <View style={styles.grid}>
              <StatTile value={s.itemOpens} label="item views" shop />
              <StatTile value={s.linkTaps} label="taps to shops" shop />
            </View>
            <Text style={styles.section}>Engagement</Text>
            <View style={styles.grid}>
              <StatTile value={s.likes} label="likes" />
              <StatTile value={s.comments} label="comments" />
              <StatTile value={s.saves} label="saves" />
            </View>

            <Text style={styles.section}>Top posts</Text>
            {s.posts.length ? (
              s.posts.map((p) => <TopPost key={p.postId} {...p} />)
            ) : (
              <Text style={type.bodyMuted}>Once people see your posts, the ones that reach the most people show here.</Text>
            )}
            <Text style={styles.note}>
              Counts include people who saw your posts on Locale in this period. Your own views and taps aren’t counted, and
              nobody else can see these numbers.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function EarningsCard() {
  const earnings = useEarnings();
  const e = earnings.data;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={e ? `Earnings: ${formatUsd(e.availableCents)} ready, ${formatUsd(e.pendingCents)} pending` : 'Earnings'}
      onPress={() => router.push('/earnings')}
      style={styles.earnings}
    >
      <View style={styles.rowText}>
        <Text style={styles.earningsValue}>{e ? formatUsd(e.availableCents + e.pendingCents) : '—'}</Text>
        <Text style={styles.meta}>Earned from sales through your posts</Text>
      </View>
      <Feather name="chevron-right" size={20} color={colors.muted} />
    </Pressable>
  );
}

function TopPost({ postId, reach, likes, linkTaps }: { postId: string; reach: number; likes: number; linkTaps: number }) {
  const post = usePost(postId);
  const media = post.data?.media[0];
  const parts = [
    `${reach.toLocaleString()} reached`,
    `${likes.toLocaleString()} ${likes === 1 ? 'like' : 'likes'}`,
    linkTaps ? `${linkTaps.toLocaleString()} ${linkTaps === 1 ? 'tap' : 'taps'} to shops` : null,
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${post.data?.caption ?? 'Post'}: ${parts.join(', ')}`}
      onPress={() => router.push(`/insights/${postId}`)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Image source={media?.url ? { uri: media.url } : undefined} style={styles.thumb} contentFit="cover" />
      <View style={styles.rowText}>
        <Text style={styles.caption} numberOfLines={1}>
          {post.data?.caption || 'Untitled post'}
        </Text>
        <Text style={styles.meta}>{parts.join(', ')}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  body: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  periods: { flexDirection: 'row', gap: space.sm, paddingVertical: space.md },
  period: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.wash },
  periodActive: { backgroundColor: colors.ink },
  periodText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  periodTextActive: { color: colors.onInk },
  loading: { marginVertical: space.xl },
  empty: { gap: space.md, paddingVertical: space.lg },
  section: {
    fontFamily: fonts.displayItalic,
    fontSize: 19,
    color: colors.ink,
    marginTop: space.lg,
    paddingBottom: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10 },
  pressed: { opacity: 0.7 },
  thumb: { width: 52, height: 52, borderRadius: radius.tag, backgroundColor: colors.wash },
  rowText: { flex: 1, gap: 2 },
  caption: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  earnings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.wash,
    borderRadius: radius.tag,
    padding: space.lg,
    marginBottom: space.sm,
  },
  earningsValue: { fontFamily: fonts.display, fontSize: 28, color: colors.ultramarine },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: space.xl },
});
