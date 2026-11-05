import * as WebBrowser from 'expo-web-browser';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import type { Item } from '@/features/posts/api';
import { colors, fonts, radius, space, type } from '@/theme';
import { formatPrice } from './link';

export function ItemSheet({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const byline = item ? [...new Set([item.brand, item.storeName].filter(Boolean))].join(', ') : '';

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
});
