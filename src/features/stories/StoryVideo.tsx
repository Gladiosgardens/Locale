import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import type { FeedMedia } from '@/features/posts/api';

// A story video: plays once with sound, pauses with the story.
export function StoryVideo({
  media,
  width,
  height,
  paused,
  onEnd,
}: {
  media: FeedMedia;
  width: number;
  height: number;
  paused: boolean;
  onEnd: () => void;
}) {
  const player = useVideoPlayer(media.videoUrl, (p) => {
    p.loop = false;
  });
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    const sub = player.addListener('playToEnd', onEnd);
    return () => sub.remove();
  }, [player, onEnd]);
  return (
    <VideoView
      player={player}
      style={{ width, height }}
      contentFit="contain"
      nativeControls={false}
      accessibilityLabel={status === 'loading' ? 'Video loading' : 'Video'}
    />
  );
}
