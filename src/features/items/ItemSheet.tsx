import * as WebBrowser from 'expo-web-browser';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, colors } from '@/components/ui';
import type { Item } from '@/features/posts/api';
import { formatPrice } from './link';

export function ItemSheet({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const byline = item ? [item.brand, item.storeName].filter(Boolean).join(' · ') : '';

  return (
    <Modal visible={!!item} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close item details" />
      {item ? (
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">{item.title}</Text>
          {byline ? <Text style={styles.byline}>{byline}</Text> : null}
          {item.priceCents != null && item.currency ? (
            <Text style={styles.price}>{formatPrice(item.priceCents, item.currency)}</Text>
          ) : null}
          {item.isAffiliate ? (
            <Text style={styles.affiliate}>Affiliate link · the poster may earn from purchases</Text>
          ) : null}
          {item.url && item.urlHost ? (
            <>
              <Button
                label={`View on ${item.urlHost}`}
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
          <Button label="Close" variant="secondary" onPress={onClose} />
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 36,
    gap: 10,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  byline: { fontSize: 15, color: colors.muted },
  price: { fontSize: 18, fontWeight: '600', color: colors.text },
  affiliate: { fontSize: 13, color: '#7A4B00', backgroundColor: '#FFF4E5', padding: 8, borderRadius: 8 },
  note: { fontSize: 13, color: colors.muted, textAlign: 'center' },
});
