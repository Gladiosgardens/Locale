import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UserAvatar } from '@/features/profiles/UserAvatar';
import { insertMention, mentionAt } from '@/lib/rich';
import { colors, fonts, space } from '@/theme';
import { MIN_PEOPLE_QUERY } from './api';
import { usePeopleSearch } from './hooks';

// While someone types "@an", lists matching people; picking one completes the handle.
export function MentionSuggestions({
  text,
  cursor,
  onChange,
}: {
  text: string;
  cursor: number;
  onChange: (text: string) => void;
}) {
  const at = mentionAt(text, cursor);
  // Only look people up once there's something to look up.
  if (!at || at.query.length < MIN_PEOPLE_QUERY) return null;
  return <Matches query={at.query} text={text} cursor={cursor} onChange={onChange} />;
}

function Matches({
  query,
  text,
  cursor,
  onChange,
}: {
  query: string;
  text: string;
  cursor: number;
  onChange: (text: string) => void;
}) {
  const people = usePeopleSearch(query);
  const list = (people.data ?? []).slice(0, 5);
  if (!list.length) return null;
  return (
    <View style={styles.box} accessibilityLabel="People to mention">
      {list.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          accessibilityLabel={`Mention @${p.handle}`}
          onPress={() => onChange(insertMention(text, cursor, p.handle).text)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <UserAvatar userId={p.id} name={p.displayName} size={28} />
          <Text style={styles.handle}>{p.handle}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {p.displayName}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline, backgroundColor: colors.paper },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 8 },
  pressed: { backgroundColor: colors.wash },
  handle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  name: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.muted },
});
