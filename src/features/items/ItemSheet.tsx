import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import type { Item } from '@/features/posts/api';
import { useSimilarItems } from '@/features/posts/hooks';
import { useItemSaved, useSaveItem } from '@/features/social/hooks';
import { recordItemEvent } from '@/features/stats/api';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, radius, space, type } from '@/theme';
import { formatPrice } from './link';

export function ItemSheet({ item, postId, onClose }: { item: Item | null; postId?: string; onClose: () => void }) {
  const saved = useItemSaved(postId ? item?.id : undefined);
  const save = useSaveItem();
  const [showSimilar, setShowSimilar] = useState(false);
  const similar = useSimilarItems(item?.id, postId, showSimilar);
  const byline = item ? [...new Set([item.brand, item.storeName].filter(Boolean))].join(', ') : '';

  // Counted for the poster's stats (their own taps are ignored by the server).
  const itemId = item?.id;
  useEffect(() => {
    if (itemId && postId) void recordItemEvent(postId, itemId, 'open').catch(() => {});
  }, [itemId, postId]);

  return (
    <Modal visible={!!item} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close item details" />
      {item ? (
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.tagHead}>
            <View style={styles.eyelet} />
            <View style={styles.headText}>
              {byline ? <Text style={styles.byline}>{byline}</Text> : null}
              <Text style={styles.title} accessibilityRole="header">
                {item.title}
              </Text>
            </View>
          </View>
          {item.priceCents != null && item.currency ? (
            <Text style={styles.price}>{formatPrice(item.priceCents, item.currency)}</Text>
          ) : null}
          {item.isAffiliate ? (
            <Text style={styles.affiliate}>Affiliate link. The poster may earn from purchases.</Text>
          ) : null}
          <View style={styles.actions}>
            {item.url && item.urlHost ? (
              <>
                <Button
                  label={`Shop on ${item.urlHost}`}
                  onPress={() => {
                    if (postId) void recordItemEvent(postId, item.id, 'link').catch(() => {});
                    void WebBrowser.openBrowserAsync(item.url!, { dismissButtonStyle: 'close' });
                  }}
                />
                <Text style={styles.note}>Opens {item.urlHost}, a site outside Locale.</Text>
              </>
            ) : item.storeName ? (
              <Text style={styles.note}>Available at {item.storeName}. No link was added.</Text>
            ) : (
              <Text style={styles.note}>The poster didn’t say where it’s from.</Text>
            )}
            {postId ? (
              <Button
                label={saved.data ? 'Saved to your wishlist' : 'Save to wishlist'}
                variant="secondary"
                onPress={() =>
                  save.mutate(
                    { itemId: item.id, postId, saved: !saved.data },
                    { onError: (e) => Alert.alert(friendlyError(e)) },
                  )
                }
              />
            ) : null}
            {postId && !showSimilar ? (
              <Button label="Find similar online" variant="quiet" onPress={() => setShowSimilar(true)} />
            ) : null}
            {showSimilar ? (
              <View style={styles.similar}>
                <Text style={styles.similarTitle}>Similar items</Text>
                <Text style={styles.note}>Found automatically. They may not be the exact item.</Text>
                {similar.isPending ? <ActivityIndicator color={colors.ink} /> : null}
                {similar.isError ? <Text style={styles.note}>{friendlyError(similar.error)}</Text> : null}
                {similar.data?.length === 0 ? <Text style={styles.note}>Nothing similar found.</Text> : null}
                <ScrollView style={styles.similarList}>
                  {(similar.data ?? []).map((m) => (
                    <Pressable
                      key={m.url}
                      accessibilityRole="link"
                      accessibilityLabel={[m.title, m.store ?? m.host, m.priceCents != null && m.currency ? formatPrice(m.priceCents, m.currency) : null]
                        .filter(Boolean)
                        .join(', ')}
                      onPress={() => void WebBrowser.openBrowserAsync(m.url, { dismissButtonStyle: 'close' })}
                      style={({ pressed }) => [styles.match, pressed && styles.pressed]}
                    >
                      <Image source={m.thumbnail ? { uri: m.thumbnail } : undefined} style={styles.matchImage} contentFit="cover" />
                      <View style={styles.matchText}>
                        <Text style={styles.matchTitle} numberOfLines={2}>
                          {m.title}
                        </Text>
                        <Text style={styles.matchMeta}>{m.store ?? m.host}</Text>
                        {m.priceCents != null && m.currency ? (
                          <Text style={styles.matchPrice}>{formatPrice(m.priceCents, m.currency)}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
            <Button label="Close" variant="quiet" onPress={onClose} />
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: space.xl,
    paddingTop: space.md,
    paddingBottom: 40,
    gap: space.md,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.hairline },
  tagHead: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', marginTop: space.sm },
  eyelet: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.ink,
    marginTop: 6,
  },
  headText: { flex: 1, gap: 2 },
  byline: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  title: { ...type.title, fontSize: 26, lineHeight: 30 },
  price: { fontFamily: fonts.semibold, fontSize: 20, color: colors.ultramarine, marginLeft: 26 },
  affiliate: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.graphite,
    backgroundColor: colors.wash,
    padding: 10,
    borderRadius: radius.tag,
  },
  actions: { gap: space.sm, marginTop: space.sm },
  note: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textAlign: 'center' },
  similar: { gap: space.sm },
  similarTitle: { fontFamily: fonts.displayItalic, fontSize: 19, color: colors.ink },
  similarList: { maxHeight: 260 },
  match: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: space.sm },
  pressed: { opacity: 0.7 },
  matchImage: { width: 52, height: 52, borderRadius: radius.tag, backgroundColor: colors.wash },
  matchText: { flex: 1, gap: 2 },
  matchTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  matchMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  matchPrice: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ultramarine },
});
