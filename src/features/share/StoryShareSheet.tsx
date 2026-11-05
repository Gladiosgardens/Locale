import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Button } from '@/components/ui';
import type { Interest } from '@/features/onboarding/api';
import type { FeedPost } from '@/features/posts/api';
import { colors, radius, space, type } from '@/theme';
import { StoryCard, type StoryCardHandle } from './StoryCard';
import { captureStory, shareStoryImage } from './storyShare';

// Preview of the story image, then one tap to open the share sheet.
export function StoryShareSheet({
  post,
  interests,
  onClose,
}: {
  post: FeedPost | null;
  interests: Map<number, Interest>;
  onClose: () => void;
}) {
  return (
    <Modal visible={!!post} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      {post ? <SheetBody key={post.id} post={post} interests={interests} onClose={onClose} /> : null}
    </Modal>
  );
}

function SheetBody({ post, interests, onClose }: { post: FeedPost; interests: Map<number, Interest>; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const card = useRef<StoryCardHandle>(null);
  const [imageReady, setImageReady] = useState(false);
  const [busy, setBusy] = useState(false);

  // Don't wait forever for the photo: after a few seconds, allow sharing anyway.
  useEffect(() => {
    const t = setTimeout(() => setImageReady(true), 4000);
    return () => clearTimeout(t);
  }, []);

  // Fit a 9:16 preview in about 60% of the screen height.
  const cardWidth = Math.round(Math.min(width - 2 * space.xl, (height * 0.6 * 9) / 16));
  const title = post.interestIds.some((id) => interests.get(id)?.section === 'style') ? 'Shop the look' : 'Shop this';

  async function share() {
    if (!card.current) return;
    setBusy(true);
    try {
      const uri = await captureStory(card.current);
      const result = await shareStoryImage(uri);
      if (result === 'unavailable') Alert.alert('Sharing isn’t available on this device.');
      else onClose();
    } catch {
      Alert.alert('We couldn’t make the image. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.handle} />
      <Text style={type.title} accessibilityRole="header">
        Share to Stories
      </Text>
      <View style={[styles.preview, { width: cardWidth }]}>
        <StoryCard ref={card} post={post} width={cardWidth} title={title} onImageReady={() => setImageReady(true)} />
      </View>
      <Text style={[type.small, styles.tip]}>
        In the share menu, pick Instagram, then Story.
      </Text>
      <Button label="Share to Instagram" onPress={share} loading={busy} disabled={!imageReady} />
      <Button label="Cancel" variant="quiet" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: space.xl,
    paddingTop: space.md,
    paddingBottom: 40,
    gap: space.md,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.hairline },
  preview: {
    alignSelf: 'center',
    borderRadius: radius.tag,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  tip: { textAlign: 'center' },
});
