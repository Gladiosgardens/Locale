import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme';

// A number with its label. Shopping numbers are ultramarine, like everything shoppable.
export function StatTile({ value, label, shop }: { value: number; label: string; shop?: boolean }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${value.toLocaleString()} ${label}`}>
      <Text style={[styles.value, shop && styles.shop]}>{value.toLocaleString()}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { width: '50%', paddingVertical: 14, paddingRight: 12, gap: 2 },
  value: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, color: colors.ink },
  shop: { color: colors.ultramarine },
  label: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
});
