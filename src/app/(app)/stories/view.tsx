import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RichText } from '@/components/RichText';
import { Button } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { ItemSheet } from '@/features/items/ItemSheet';
import { formatPrice } from '@/features/items/link';
import type { Item } from '@/features/posts/api';
import { useDeletePost } from '@/features/posts/hooks';
import { UserAvatar } from '@/features/profiles/UserAvatar';
import { ReportSheet, type ReportSubject } from '@/features/safety/ReportSheet';
import { PHOTO_STORY_MS, type Story } from '@/features/stories/api';
import { useMarkSeen, useRemoveFromHighlight, useStories } from '@/features/stories/hooks';
import { HighlightSheet, ViewersSheet } from '@/features/stories/StorySheets';
import { StoryVideo } from '@/features/stories/StoryVideo';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/time';
import { colors, fonts, radius, space } from '@/theme';

const TICK_MS = 50;

// Full-screen stories: tap the right side for the next one, the left for the
// previous one, hold to pause. Tagged items can be shopped from the story.
export default function StoryViewer() {
  const params = useLocalSearchParams<{ author?: string; highlight?: string; name?: string; queue?: string }>();
  const source = useMemo(
    () => (params.highlight ? { highlightId: params.highlight } : params.author ? { authorId: params.author } : null),
    [params.highlight, params.author],
  );
  const stories = useStories(source);
  const list = stories.data ?? [];

  if (stories.isPending) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.onInk} />
      </View>
    );
  }
  if (!list.length) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.emptyText}>
          {stories.isError ? 'We couldn’t load this story.' : 'This story has ended.'}
        </Text>
        <Button label="Close" variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }
  return (
    <Player
      key={params.highlight ?? params.author}
      stories={list}
      highlightId={params.highlight ?? null}
      title={params.name ?? null}
      queue={(params.queue ?? '').split(',').filter(Boolean)}
      authorId={params.author ?? null}
    />
  );
}

function Player({
  stories,
  highlightId,
  title,
  queue,
  authorId,
}: {
  stories: Story[];
  highlightId: string | null;
  title: string | null;
  queue: string[];
  authorId: string | null;
}) {
  const { width, height } = useWindowDimensions();
  const { session } = useAuth();
  // Start at the first story not seen yet (live stories only).
  const [index, setIndex] = useState(() =>
    highlightId
      ? 0
      : Math.max(
          stories.findIndex((s) => !s.seen),
          0,
        ),
  );
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const [sheet, setSheet] = useState<'menu' | 'viewers' | 'highlight' | 'items' | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [report, setReport] = useState<ReportSubject | null>(null);
  const markSeen = useMarkSeen();
  const remove = useDeletePost();
  const unhighlight = useRemoveFromHighlight();
  const story = stories[Math.min(index, stories.length - 1)];
  const isMine = story.author.id === session?.user.id;
  const media = story.media;
  const items = media.tags;
  const paused = held || sheet !== null || item !== null || report !== null;
  const total = media.kind === 'video' && media.duration ? media.duration * 1000 : PHOTO_STORY_MS;

  const finish = useCallback(() => {
    // Live stories move on to the next person in the tray.
    const at = authorId ? queue.indexOf(authorId) : -1;
    const next = at >= 0 ? queue[at + 1] : undefined;
    if (!highlightId && next) {
      router.replace({ pathname: '/stories/view', params: { author: next, queue: queue.join(',') } });
    } else {
      router.back();
    }
  }, [authorId, queue, highlightId]);

  const go = useCallback(
    (step: 1 | -1) => {
      elapsedRef.current = 0;
      setElapsed(0);
      if (step === 1 && index >= stories.length - 1) return finish();
      setIndex((i) => Math.max(0, i + step));
    },
    [index, stories.length, finish],
  );

  const { mutate: seen } = markSeen;
  useEffect(() => {
    if (!isMine && !story.seen) seen(story.id);
  }, [story.id, story.seen, isMine, seen]);

  // Photos advance on a timer; videos also end on their own (onEnd).
  const elapsedRef = useRef(0);
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  }, [go]);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      const next = Math.min(elapsedRef.current + TICK_MS, total);
      elapsedRef.current = next;
      setElapsed(next);
      if (next >= total) goRef.current(1);
    }, TICK_MS);
    return () => clearInterval(t);
  }, [paused, total]);

  // Fit the media inside the screen; tag dots use the same frame.
  const frame = useMemo(() => {
    const scale = Math.min(width / media.width, height / media.height);
    const w = media.width * scale;
    const h = media.height * scale;
    return { w, h, left: (width - w) / 2, top: (height - h) / 2 };
  }, [width, height, media.width, media.height]);

  function menu() {
    setSheet('menu');
  }

  function deleteStory() {
    setSheet(null);
    Alert.alert('Delete this story?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          remove.mutate(story.id, { onSuccess: () => router.back(), onError: (e) => Alert.alert(friendlyError(e)) }),
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={`Story ${index + 1} of ${stories.length}. Tap for the next one.`}
        accessibilityActions={[
          { name: 'activate', label: 'Next story' },
          { name: 'previous', label: 'Previous story' },
        ]}
        onAccessibilityAction={(e) => go(e.nativeEvent.actionName === 'previous' ? -1 : 1)}
        onPress={(e) => go(e.nativeEvent.locationX < width / 3 ? -1 : 1)}
        onLongPress={() => setHeld(true)}
        onPressOut={() => setHeld(false)}
        delayLongPress={200}
      >
        <View style={{ position: 'absolute', left: frame.left, top: frame.top }}>
          {media.kind === 'video' ? (
            <StoryVideo
              key={story.id}
              media={media}
              width={frame.w}
              height={frame.h}
              paused={paused}
              onEnd={() => go(1)}
            />
          ) : media.url ? (
            <Image source={{ uri: media.url }} style={{ width: frame.w, height: frame.h }} contentFit="contain" />
          ) : null}
          {media.kind === 'image'
            ? items.map((t) => (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Shop ${t.item.title}`}
                  onPress={() => setItem(t.item)}
                  hitSlop={12}
                  style={[styles.dot, { left: t.x * frame.w - 9, top: t.y * frame.h - 9 }]}
                />
              ))
            : null}
        </View>
      </Pressable>

      <SafeAreaView style={styles.top} edges={['top']} pointerEvents="box-none">
        <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {stories.map((s, i) => (
            <View key={s.id} style={styles.bar}>
              <View
                style={[
                  styles.barFill,
                  { width: i < index ? '100%' : i > index ? '0%' : `${(elapsed / total) * 100}%` },
                ]}
              />
            </View>
          ))}
        </View>
        <View style={styles.header} pointerEvents="box-none">
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push(`/profile/${story.author.id}`)}
            style={styles.who}
          >
            <UserAvatar userId={story.author.id} name={story.author.displayName} size={32} />
            <Text style={styles.handle}>{title ?? story.author.handle}</Text>
            <Text style={styles.time}>{timeAgo(story.publishedAt)}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Story options" onPress={menu} hitSlop={10}>
            <Feather name="more-horizontal" size={24} color={colors.onInk} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close stories"
            onPress={() => router.back()}
            hitSlop={10}
          >
            <Feather name="x" size={26} color={colors.onInk} />
          </Pressable>
        </View>
      </SafeAreaView>

      <SafeAreaView style={styles.bottom} edges={['bottom']} pointerEvents="box-none">
        {story.caption ? <RichText text={story.caption} style={styles.caption} /> : null}
        <View style={styles.actions} pointerEvents="box-none">
          {items.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={items.length === 1 ? 'Shop this' : `Shop ${items.length} items`}
              onPress={() => (items.length === 1 ? setItem(items[0].item) : setSheet('items'))}
              style={styles.shop}
            >
              <Feather name="shopping-bag" size={16} color={colors.paper} />
              <Text style={styles.shopText}>{items.length === 1 ? 'Shop this' : `Shop ${items.length} items`}</Text>
            </Pressable>
          ) : (
            <View />
          )}
          {isMine && story.viewCount != null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Seen by ${story.viewCount}`}
              onPress={() => setSheet('viewers')}
              style={styles.views}
              hitSlop={8}
            >
              <Feather name="eye" size={16} color={colors.onInk} />
              <Text style={styles.viewsText}>{story.viewCount}</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>

      <Modal
        visible={sheet === 'menu' || sheet === 'items'}
        transparent
        animationType="slide"
        onRequestClose={() => setSheet(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSheet(null)} accessibilityLabel="Close" />
        <View style={styles.sheet} accessibilityViewIsModal>
          {sheet === 'items'
            ? items.map((t) => (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setSheet(null);
                    setItem(t.item);
                  }}
                  style={styles.itemRow}
                >
                  <View style={styles.itemDot} />
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {t.item.title}
                  </Text>
                  {t.item.priceCents != null && t.item.currency ? (
                    <Text style={styles.itemPrice}>{formatPrice(t.item.priceCents, t.item.currency)}</Text>
                  ) : null}
                </Pressable>
              ))
            : isMine
              ? [
                  <Button key="v" label="Viewers" variant="quiet" onPress={() => setSheet('viewers')} />,
                  items.length ? (
                    <Button
                      key="i"
                      label="Item insights"
                      variant="quiet"
                      onPress={() => {
                        setSheet(null);
                        router.push(`/insights/${story.id}`);
                      }}
                    />
                  ) : null,
                  <Button key="h" label="Add to highlight" variant="quiet" onPress={() => setSheet('highlight')} />,
                  highlightId ? (
                    <Button
                      key="r"
                      label="Remove from this highlight"
                      variant="quiet"
                      onPress={() =>
                        unhighlight.mutate(
                          { highlightId, storyId: story.id },
                          { onSuccess: () => router.back(), onError: (e) => Alert.alert(friendlyError(e)) },
                        )
                      }
                    />
                  ) : null,
                  <Button key="d" label="Delete story" variant="quiet" onPress={deleteStory} />,
                ]
              : [
                  <Button
                    key="rep"
                    label="Report story"
                    variant="quiet"
                    onPress={() => {
                      setSheet(null);
                      setReport({ type: 'post', id: story.id, label: `@${story.author.handle}’s story` });
                    }}
                  />,
                ]}
          <Button label="Cancel" variant="secondary" onPress={() => setSheet(null)} />
        </View>
      </Modal>
      <ViewersSheet storyId={sheet === 'viewers' ? story.id : null} onClose={() => setSheet(null)} />
      <HighlightSheet storyId={sheet === 'highlight' ? story.id : null} onClose={() => setSheet(null)} />
      <ItemSheet item={item} postId={story.id} onClose={() => setItem(null)} />
      <ReportSheet subject={report} onClose={() => setReport(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  emptyText: { fontFamily: fonts.body, fontSize: 16, color: colors.onInk },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  bars: { flexDirection: 'row', gap: 4, paddingHorizontal: space.sm, paddingTop: space.sm },
  bar: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.onInk },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  handle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.onInk },
  time: { fontFamily: fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  dot: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.ultramarine,
    borderWidth: 2,
    borderColor: colors.paper,
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, gap: space.md },
  caption: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 22,
    color: colors.onInk,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.ultramarine,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  shopText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.paper },
  views: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewsText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.onInk },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: space.xl,
    paddingBottom: 40,
    gap: space.sm,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12 },
  itemDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.ultramarine },
  itemTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  itemPrice: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ultramarine },
});
