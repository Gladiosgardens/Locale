import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PeopleTagDraft, PickedPhoto } from '@/features/posts/api';
import { UserAvatar } from '@/features/profiles/UserAvatar';
import { colors, fonts, radius, space, type } from '@/theme';
import { MIN_PEOPLE_QUERY } from './api';
import { usePeopleSearch } from './hooks';

export const MAX_PEOPLE_TAGS = 20;

type Props = {
  photo: PickedPhoto | null;
  position: number;
  tags: PeopleTagDraft[];
  /** Tags left for the whole post. */
  remaining: number;
  onChange: (tags: PeopleTagDraft[]) => void;
  onClose: () => void;
};

// Tap the photo where someone is, then pick them. Tap a name to remove it.
export function PeopleTagEditor(props: Props) {
  return (
    <Modal visible={!!props.photo} animationType="slide" onRequestClose={props.onClose}>
      {props.photo ? <Editor {...props} photo={props.photo} /> : null}
    </Modal>
  );
}

function Editor({ photo, position, tags, remaining, onChange, onClose }: Props & { photo: PickedPhoto }) {
  const { width } = useWindowDimensions();
  const height = Math.min(Math.round((width * photo.height) / photo.width), Math.round(width * 1.25));
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const people = usePeopleSearch(pending ? query : '');
  const tagged = new Set(tags.map((t) => t.profileId));

  function startAt(x: number, y: number) {
    if (remaining <= 0) return;
    setPending({ x: Math.min(Math.max(x / width, 0), 1), y: Math.min(Math.max(y / height, 0), 1) });
    setQuery('');
  }

  function pick(p: { id: string; handle: string }) {
    if (!pending) return;
    onChange([
      ...tags.filter((t) => t.profileId !== p.id),
      { position, profileId: p.id, handle: p.handle, ...pending },
    ]);
    setPending(null);
    setQuery('');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={type.title} accessibilityRole="header">
          Tag people
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled">
        {
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Photo. Tap where a person is to tag them."
            onPress={(e) => startAt(e.nativeEvent.locationX, e.nativeEvent.locationY)}
          >
            <Image source={photo.thumbnail ?? { uri: photo.uri }} style={{ width, height }} contentFit="cover" />
            {tags.map((t) => (
              <Pressable
                key={t.profileId}
                accessibilityRole="button"
                accessibilityLabel={`Remove @${t.handle}`}
                onPress={() => onChange(tags.filter((x) => x.profileId !== t.profileId))}
                style={[styles.label, { left: Math.min(t.x * width, width - 120), top: t.y * height }]}
              >
                <Text style={styles.labelText} numberOfLines={1}>
                  {t.handle}
                </Text>
                <Feather name="x" size={12} color={colors.onInk} />
              </Pressable>
            ))}
            {pending ? (
              <View
                style={[styles.dot, { left: pending.x * width - 8, top: pending.y * height - 8 }]}
                pointerEvents="none"
              />
            ) : null}
          </Pressable>
        }

        <View style={styles.body}>
          {pending ? (
            <>
              <TextInput
                accessibilityLabel="Search for a person"
                style={styles.search}
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name or @username"
                placeholderTextColor={colors.muted}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
              />
              {people.isFetching ? <ActivityIndicator color={colors.ink} /> : null}
              {query.trim().replace(/^@/, '').length >= MIN_PEOPLE_QUERY && people.data?.length === 0 ? (
                <Text style={type.bodyMuted}>Nobody found.</Text>
              ) : null}
              {(people.data ?? []).slice(0, 8).map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Tag @${p.handle}`}
                  onPress={() => pick(p)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <UserAvatar userId={p.id} name={p.displayName} size={36} />
                  <View style={styles.rowText}>
                    <Text style={styles.handle}>{p.handle}</Text>
                    <Text style={styles.name}>{tagged.has(p.id) ? 'Tagged, tap to move here' : p.displayName}</Text>
                  </View>
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" onPress={() => setPending(null)} hitSlop={8}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </>
          ) : (
            <Text style={type.bodyMuted}>
              {remaining <= 0
                ? `You can tag up to ${MAX_PEOPLE_TAGS} people in a post.`
                : tags.length
                  ? 'Tap a name to remove it, or tap the photo to tag someone else.'
                  : 'Tap the photo where someone is to tag them. They’ll be told and can remove themselves.'}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  done: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  label: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 120,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.tag,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  labelText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.onInk, flexShrink: 1 },
  dot: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.onInk,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  body: { padding: space.lg, gap: space.md },
  search: {
    backgroundColor: colors.wash,
    borderRadius: radius.tag,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 6 },
  pressed: { opacity: 0.7 },
  rowText: { flex: 1 },
  handle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  name: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  cancel: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: space.sm,
  },
});
