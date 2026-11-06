import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { FeedMedia } from '@/features/posts/api';
import { colors } from '@/theme';

// A feed video: plays muted and on loop while it's the post on screen, pauses
// otherwise. Tap to turn the sound on or off. The poster frame shows until it plays.
export function VideoMedia({ media, width, height, active }: { media: FeedMedia; width: number; height: number; active: boolean }) {
  const player = useVideoPlayer(media.videoUrl, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const [muted, setMuted] = useState(true);
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  useEffect(() => {
    // expo-video players are controlled by setting properties on them.
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [muted, player]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={muted ? 'Turn sound on' : 'Turn sound off'}
      onPress={() => setMuted((m) => !m)}
      style={{ width, height, backgroundColor: colors.ink }}
    >
      <VideoView player={player} style={{ width, height }} contentFit="cover" nativeControls={false} />
      {!isPlaying && media.url ? (
        <Image
          source={{ uri: media.url }}
          style={[StyleSheet.absoluteFill, { width, height }]}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <View style={styles.sound} pointerEvents="none">
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={16} color={colors.paper} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sound: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
