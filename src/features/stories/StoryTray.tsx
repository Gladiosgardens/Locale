import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { useProfile } from '@/features/profiles/hooks';
import { colors, fonts, space } from '@/theme';
import { useStoryTray } from './hooks';
import { StoryRing } from './StoryRing';

const SIZE = 62;

// The row of circles at the top of Home: your story first, then people you follow.
export function StoryTray() {
  const tray = useStoryTray();
  const { session } = useAuth();
  const me = useProfile(session?.user.id);
  const entries = tray.data ?? [];
  const mine = entries.find((e) => e.isMe);
  const others = entries.filter((e) => !e.isMe);
  const queue = others.map((e) => e.author.id).join(',');
  const myId = session?.user.id;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="Stories"
    >
      {myId ? (
        <View style={styles.entry}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mine ? 'Your story' : 'Add to your story'}
            onPress={() =>
              mine ? router.push({ pathname: '/stories/view', params: { author: myId } }) : router.push('/new-story')
            }
          >
            <StoryRing userId={myId} name={me.data?.displayName ?? ''} size={SIZE} state={mine ? 'seen' : 'none'} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add to your story"
            onPress={() => router.push('/new-story')}
            style={styles.plus}
            hitSlop={8}
          >
            <Feather name="plus" size={14} color={colors.onInk} />
          </Pressable>
          <Text style={styles.name} numberOfLines={1}>
            Your story
          </Text>
        </View>
      ) : null}
      {others.map((e) => (
        <Pressable
          key={e.author.id}
          accessibilityRole="button"
          accessibilityLabel={`${e.author.displayName}’s story${e.allSeen ? '' : ', new'}`}
          onPress={() => router.push({ pathname: '/stories/view', params: { author: e.author.id, queue } })}
          style={styles.entry}
        >
          <StoryRing
            userId={e.author.id}
            name={e.author.displayName}
            size={SIZE}
            state={e.allSeen ? 'seen' : 'unseen'}
          />
          <Text style={[styles.name, !e.allSeen && styles.unseen]} numberOfLines={1}>
            {e.author.handle}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  entry: { width: SIZE + 12, alignItems: 'center', gap: 4 },
  plus: {
    position: 'absolute',
    top: SIZE - 10,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, maxWidth: SIZE + 12 },
  unseen: { color: colors.ink },
});
