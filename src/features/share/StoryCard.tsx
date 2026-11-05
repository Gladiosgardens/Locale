import { Image } from 'expo-image';
import { forwardRef, useMemo, type ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatPrice } from '@/features/items/link';
import type { FeedPost, Item } from '@/features/posts/api';
import { colors, fonts } from '@/theme';

// A 9:16 story image of a post (Instagram, Snapchat, TikTok, Facebook): the photo with numbered tag
// dots, the tagged pieces with prices, and who posted it. Everything is
// sized from `width`, so the preview and the exported 1080x1920 image match.

const MAX_LISTED = 3;

export type StoryCardProps = { post: FeedPost; width: number; title: string; onImageReady?: () => void };

export type StoryCardHandle = ComponentRef<typeof View>;

export const StoryCard = forwardRef<StoryCardHandle, StoryCardProps>(function StoryCard({ post, width, title, onImageReady }, ref) {
  const u = width / 360; // design unit: the card is drawn on a 360-wide grid
  const height = Math.round((width * 16) / 9);
  const media = post.media[0];

  const items = useMemo(() => {
    const seen = new Map<string, Item>();
    for (const m of post.media) for (const t of m.tags) if (!seen.has(t.item.id)) seen.set(t.item.id, t.item);
    return [...seen.values()];
  }, [post.media]);
  const numbers = useMemo(() => new Map(items.map((it, i) => [it.id, i + 1])), [items]);
  const listed = items.slice(0, MAX_LISTED);

  // The photo fills its frame ("cover"); work out the crop so dots land on the right spot.
  const frameW = width;
  const frameH = items.length ? Math.round(height * 0.58) : Math.round(height * 0.7);
  // Story apps draw their reply bars over the bottom ~10%; keep the footer above that.
  const safeBottom = Math.round(height * 0.1);
  const dots = useMemo(() => {
    if (!media) return [];
    const scale = Math.max(frameW / media.width, frameH / media.height);
    const offX = (media.width * scale - frameW) / 2;
    const offY = (media.height * scale - frameH) / 2;
    return media.tags
      .map((t) => ({ id: t.id, n: numbers.get(t.item.id), x: t.x * media.width * scale - offX, y: t.y * media.height * scale - offY }))
      .filter((d) => d.x > 0 && d.y > 0 && d.x < frameW && d.y < frameH);
  }, [media, frameW, frameH, numbers]);

  const dot = 26 * u;
  // Keep each dot fully on the photo, even when the tag sits right at the edge.
  const clamp = (v: number, max: number) => Math.min(Math.max(v, dot / 2 + 4 * u), max - dot / 2 - 4 * u);

  return (
    <View ref={ref} collapsable={false} style={{ width, height, backgroundColor: colors.paper }}>
      <View style={{ width: frameW, height: frameH, backgroundColor: colors.wash }}>
        {media?.url ? (
          <Image
            source={{ uri: media.url, cacheKey: media.path }}
            style={{ width: frameW, height: frameH }}
            contentFit="cover"
            testID="story-photo"
            onLoad={onImageReady}
            onError={onImageReady}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        {dots.map((d) => (
          <View
            key={d.id}
            style={[
              styles.dot,
              {
                width: dot,
                height: dot,
                borderRadius: dot / 2,
                left: clamp(d.x, frameW) - dot / 2,
                top: clamp(d.y, frameH) - dot / 2,
              },
            ]}
          >
            <Text style={[styles.dotText, { fontSize: 13 * u }]}>{d.n}</Text>
          </View>
        ))}
      </View>

      <View style={{ flex: 1, paddingHorizontal: 22 * u, paddingTop: 16 * u, paddingBottom: safeBottom }}>
        {listed.length ? (
          <>
            <Text style={[styles.title, { fontSize: 22 * u, marginBottom: 8 * u }]}>{title}</Text>
            {listed.map((it) => {
              const where = it.brand ?? it.storeName ?? it.urlHost;
              const price = it.priceCents != null && it.currency ? formatPrice(it.priceCents, it.currency) : null;
              return (
                <View key={it.id} style={[styles.itemRow, { gap: 10 * u, paddingVertical: 5 * u }]}>
                  <View style={[styles.eyelet, { width: 18 * u, height: 18 * u, borderRadius: 9 * u }]}>
                    <Text style={[styles.eyeletText, { fontSize: 10 * u }]}>{numbers.get(it.id)}</Text>
                  </View>
                  <Text style={[styles.itemText, { fontSize: 14 * u }]} numberOfLines={1}>
                    {where ? <Text style={styles.itemBrand}>{where} </Text> : null}
                    {it.title}
                  </Text>
                  {price ? <Text style={[styles.price, { fontSize: 14 * u }]}>{price}</Text> : null}
                </View>
              );
            })}
            {items.length > MAX_LISTED ? (
              <Text style={[styles.more, { fontSize: 12 * u, marginTop: 4 * u }]}>
                {`+${items.length - MAX_LISTED} more on Locale`}
              </Text>
            ) : null}
          </>
        ) : post.caption ? (
          <Text style={[styles.caption, { fontSize: 17 * u, lineHeight: 24 * u }]} numberOfLines={3}>
            {post.caption}
          </Text>
        ) : null}

        <View style={styles.footer}>
          <Text style={[styles.wordmark, { fontSize: 30 * u }]}>Locale</Text>
          <View style={styles.footerRight}>
            <Text style={[styles.handle, { fontSize: 14 * u }]}>@{post.author.handle}</Text>
            <Text style={[styles.cta, { fontSize: 11 * u }]}>
              {items.length ? 'Find every piece on Locale' : 'More on Locale'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: { fontFamily: fonts.bold, color: colors.ink },
  title: { fontFamily: fonts.displayItalic, color: colors.ink },
  itemRow: { flexDirection: 'row', alignItems: 'center' },
  eyelet: { borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  eyeletText: { fontFamily: fonts.bold, color: colors.ink },
  itemText: { flex: 1, fontFamily: fonts.semibold, color: colors.ink },
  itemBrand: { fontFamily: fonts.body, color: colors.muted },
  price: { fontFamily: fonts.semibold, color: colors.ultramarine },
  more: { fontFamily: fonts.medium, color: colors.muted },
  caption: { fontFamily: fonts.display, color: colors.ink },
  footer: { marginTop: 'auto', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  wordmark: { fontFamily: fonts.displayItalic, color: colors.ink, letterSpacing: -0.5 },
  footerRight: { alignItems: 'flex-end' },
  handle: { fontFamily: fonts.semibold, color: colors.ink },
  cta: { fontFamily: fonts.body, color: colors.muted },
});
