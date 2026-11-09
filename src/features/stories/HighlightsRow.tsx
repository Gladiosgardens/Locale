import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, space } from '@/theme';
import { useDeleteHighlight, useProfileHighlights } from './hooks';

const SIZE = 60;

// Saved stories on a profile. Long-press your own to delete one.
export function HighlightsRow({ profileId, isMe }: { profileId: string; isMe: boolean }) {
  const highlights = useProfileHighlights(profileId);
  const remove = useDeleteHighlight();
  const list = highlights.data ?? [];
  if (!list.length && !isMe) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="Highlights"
    >
      {list.map((h) => (
        <Pressable
          key={h.id}
          accessibilityRole="button"
          accessibilityLabel={`Highlight: ${h.name}, ${h.count} ${h.count === 1 ? 'story' : 'stories'}`}
          accessibilityHint={isMe ? 'Long press to delete' : undefined}
          onPress={() => router.push({ pathname: '/stories/view', params: { highlight: h.id, name: h.name } })}
          onLongPress={
            isMe
              ? () =>
                  Alert.alert(`Delete ${h.name}?`, 'The stories stay in your archive; only the highlight goes.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => remove.mutate(h.id, { onError: (e) => Alert.alert(friendlyError(e)) }),
                    },
                  ])
              : undefined
          }
          style={styles.entry}
        >
          <View style={styles.ring}>
            <Image source={h.coverUrl ? { uri: h.coverUrl } : undefined} style={styles.cover} contentFit="cover" />
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {h.name}
          </Text>
        </Pressable>
      ))}
      {isMe && !list.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New story for a highlight"
          onPress={() => router.push('/new-story')}
          style={styles.entry}
        >
          <View style={[styles.ring, styles.newRing]}>
            <Feather name="plus" size={22} color={colors.ink} />
          </View>
          <Text style={styles.name}>New</Text>
        </Pressable>
      ) : null}
      {isMe && !list.length ? (
        <Text style={styles.help}>Share a story, then choose Add to highlight to keep it here.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.md, paddingVertical: space.xs, alignItems: 'center' },
  entry: { width: SIZE + 8, alignItems: 'center', gap: 4 },
  ring: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newRing: { borderStyle: 'dashed', borderColor: colors.muted },
  cover: { width: SIZE - 8, height: SIZE - 8, borderRadius: (SIZE - 8) / 2, backgroundColor: colors.wash },
  name: { fontFamily: fonts.body, fontSize: 12, color: colors.ink, maxWidth: SIZE + 8 },
  help: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, maxWidth: 220 },
});
