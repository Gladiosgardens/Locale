import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, radius, space } from '@/theme';
import type { Person } from './api';
import { useFollowPerson } from './hooks';
import { UserAvatar } from '@/features/profiles/UserAvatar';

export function PersonRow({ person }: { person: Person }) {
  const followMut = useFollowPerson();
  // Local state so the button flips at once and the row stays put in the list.
  const [following, setFollowing] = useState(person.iFollow);

  function toggle() {
    const next = !following;
    setFollowing(next);
    followMut.mutate(
      { id: person.id, follow: next },
      {
        onError: (e) => {
          setFollowing(!next);
          Alert.alert(friendlyError(e));
        },
      },
    );
  }

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.who}
        accessibilityRole="link"
        accessibilityLabel={`Open ${person.displayName}’s profile`}
        onPress={() => router.push(`/profile/${person.id}`)}
      >
        <UserAvatar userId={person.id} name={person.displayName} size={48} />
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>
            {person.displayName}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            @{person.handle}
            {person.note ? `, ${person.note.charAt(0).toLowerCase()}${person.note.slice(1)}` : ''}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={following ? `Unfollow ${person.displayName}` : `Follow ${person.displayName}`}
        accessibilityState={{ selected: following }}
        onPress={toggle}
        style={({ pressed }) => [styles.button, following && styles.buttonOn, pressed && styles.pressed]}
        hitSlop={6}
      >
        <Text style={[styles.buttonText, following && styles.buttonTextOn]}>{following ? 'Following' : 'Follow'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  button: {
    minWidth: 92,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
  buttonOn: { backgroundColor: colors.wash },
  pressed: { opacity: 0.75 },
  buttonText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.onInk },
  buttonTextOn: { color: colors.ink },
});
