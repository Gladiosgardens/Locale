import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/components/ui';
import type { Group } from './api';

export function membershipLabel(g: Group): string | null {
  if (g.myStatus === 'pending') return 'Requested';
  if (g.myStatus === 'banned') return null;
  if (g.myRole === 'owner') return 'Owner';
  if (g.myRole === 'moderator') return 'Moderator';
  if (g.myStatus === 'active') return 'Joined';
  return null;
}

export function GroupCard({ group, interestLabel, onPress }: { group: Group; interestLabel?: string; onPress: () => void }) {
  const badge = membershipLabel(group);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Group ${group.name}`} style={styles.card} onPress={onPress}>
      <View style={styles.row}>
        <Text style={styles.name} numberOfLines={1}>{group.name}</Text>
        {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      </View>
      <Text style={styles.meta}>
        {[interestLabel, group.privacy === 'private' ? 'Private' : 'Public', `${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`, group.areaName]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {group.pendingCount > 0 ? (
        <Text style={styles.pending}>{group.pendingCount} waiting to join</Text>
      ) : null}
      {group.description ? <Text style={styles.description} numberOfLines={2}>{group.description}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, gap: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  badge: { fontSize: 12, color: colors.accent, backgroundColor: colors.chip, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  meta: { fontSize: 13, color: colors.muted },
  pending: { fontSize: 13, color: '#7A4B00' },
  description: { fontSize: 14, color: colors.text, lineHeight: 20, marginTop: 2 },
});
