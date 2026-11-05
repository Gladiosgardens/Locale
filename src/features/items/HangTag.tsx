import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Item } from '@/features/posts/api';
import { colors, fonts, radius, space } from '@/theme';
import { formatPrice } from './link';

// The shoppable item, drawn as a garment hang tag: a stub with an eyelet,
// then brand, name and price. It's Locale's signature shape, used wherever
// something in a photo can be bought.
export function HangTag({
  item,
  onPress,
  highlighted,
  index,
}: {
  item: Item;
  onPress: () => void;
  highlighted?: boolean;
  index?: number;
}) {
  const price = item.priceCents != null && item.currency ? formatPrice(item.priceCents, item.currency) : null;
  const where = item.brand ?? item.storeName ?? item.urlHost;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[item.title, where, price].filter(Boolean).join(', ')}
      accessibilityHint="Shows where to get it"
      onPress={onPress}
      style={({ pressed }) => [styles.tag, highlighted && styles.tagHighlighted, pressed && styles.pressed]}
    >
      <View style={[styles.stub, highlighted && styles.stubHighlighted]}>
        <View style={styles.eyelet} />
        {index != null ? <Text style={styles.number}>{index}</Text> : null}
      </View>
      <View style={styles.body}>
        {where ? (
          <Text style={styles.brand} numberOfLines={1}>
            {where}
          </Text>
        ) : null}
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        {price ? <Text style={styles.price}>{price}</Text> : item.url ? <Text style={styles.link}>View item</Text> : null}
      </View>
    </Pressable>
  );
}

// Horizontal strip of hang tags under a post. Items are numbered to match the dots on the photo.
export function ShopTheLook({
  items,
  highlight = [],
  onOpen,
}: {
  items: Item[];
  highlight?: string[];
  onOpen: (item: Item) => void;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.strip}>
      <Text style={styles.heading}>Shop the look</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item, i) => (
          <HangTag
            key={item.id}
            item={item}
            index={i + 1}
            highlighted={highlight.includes(item.id)}
            onPress={() => onOpen(item)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { paddingTop: space.md, gap: space.sm },
  heading: { fontFamily: fonts.displayItalic, fontSize: 18, color: colors.ink, paddingHorizontal: space.lg },
  row: { gap: space.sm, paddingHorizontal: space.lg },
  tag: {
    flexDirection: 'row',
    width: 196,
    minHeight: 76,
    borderRadius: radius.tag,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.paper,
    overflow: 'hidden',
  },
  tagHighlighted: { borderColor: colors.ultramarine },
  pressed: { opacity: 0.7 },
  stub: {
    width: 28,
    alignItems: 'center',
    paddingTop: 10,
    gap: 8,
    backgroundColor: colors.wash,
    borderRightWidth: 1,
    borderRightColor: colors.hairline,
  },
  stubHighlighted: { backgroundColor: colors.ultramarineWash, borderRightColor: colors.ultramarine },
  eyelet: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
  },
  number: { fontFamily: fonts.semibold, fontSize: 11, color: colors.muted },
  body: { flex: 1, paddingHorizontal: 10, paddingVertical: 9, gap: 2 },
  brand: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  title: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: colors.ink },
  price: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ultramarine, marginTop: 2 },
  link: { fontFamily: fonts.medium, fontSize: 13, color: colors.ultramarine, marginTop: 2 },
});
