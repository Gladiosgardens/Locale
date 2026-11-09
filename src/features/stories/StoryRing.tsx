import { StyleSheet, View } from 'react-native';
import { UserAvatar } from '@/features/profiles/UserAvatar';
import { colors } from '@/theme';

export type RingState = 'none' | 'unseen' | 'seen';

// An avatar with a ring when the person has a live story: black when there's
// something new, grey once you've seen it all.
export function StoryRing({
  userId,
  name,
  size,
  state,
}: {
  userId: string;
  name: string;
  size: number;
  state: RingState;
}) {
  const ring = state === 'none' ? 0 : state === 'unseen' ? 2.5 : 1.5;
  const gap = state === 'none' ? 0 : 3;
  const outer = size + 2 * (ring + gap);
  return (
    <View
      style={[
        styles.ring,
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderWidth: ring,
          borderColor: state === 'unseen' ? colors.ink : colors.hairline,
        },
      ]}
    >
      <UserAvatar userId={userId} name={name} size={size} />
    </View>
  );
}

const styles = StyleSheet.create({ ring: { alignItems: 'center', justifyContent: 'center' } });
