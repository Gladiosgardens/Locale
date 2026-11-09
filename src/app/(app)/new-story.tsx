import Feather from '@expo/vector-icons/Feather';
import { createVideoPlayer } from 'expo-video';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorText } from '@/components/ui';
import { TagEditor } from '@/features/items/TagEditor';
import { MentionSuggestions } from '@/features/people/MentionSuggestions';
import type { DraftTag, PickedPhoto, PickedVideo } from '@/features/posts/api';
import { useDetectItems, usePublishPost } from '@/features/posts/hooks';
import { MAX_STORY_CAPTION } from '@/features/stories/api';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, radius, space, type } from '@/theme';

const MAX_VIDEO_MS = 60_000;

// A story: one photo or video, an optional line of text and tagged items.
export default function NewStory() {
  const { width } = useWindowDimensions();
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [caption, setCaption] = useState('');
  const [cursor, setCursor] = useState(0);
  const [tags, setTags] = useState<DraftTag[]>([]);
  const [tagging, setTagging] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const publish = usePublishPost((stage) =>
    setProgress(stage === 'publishing' ? 'Sharing…' : stage === 'preparing' ? 'Preparing…' : 'Uploading…'),
  );
  const detect = useDetectItems();
  const busy = publish.isPending;
  const previewHeight = photo ? Math.min((width - 2 * space.lg) * (photo.height / photo.width), 460) : 0;

  async function pick(kind: 'images' | 'videos') {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: [kind],
      allowsEditing: kind === 'videos',
      videoMaxDuration: 60,
      exif: false,
      quality: 1,
    });
    if (result.canceled) return;
    const a = result.assets[0];
    setTags([]);
    if (kind === 'videos') {
      if ((a.duration ?? 0) > MAX_VIDEO_MS) {
        setError('Videos can be up to 60 seconds. Trim it in your Photos app, then try again.');
        return;
      }
      let thumbnail: PickedPhoto['thumbnail'];
      try {
        const player = createVideoPlayer(a.uri);
        [thumbnail] = await player.generateThumbnailsAsync(0.5);
        player.release();
      } catch {
        thumbnail = undefined;
      }
      setVideo({ uri: a.uri, width: a.width, height: a.height, durationMs: a.duration ?? 0 });
      setPhoto({ uri: a.uri, width: a.width, height: a.height, thumbnail });
    } else {
      setVideo(null);
      setPhoto({ uri: a.uri, width: a.width, height: a.height });
    }
  }

  async function share() {
    if (!photo) return;
    setError(null);
    try {
      await publish.mutateAsync({
        photos: video ? [] : [photo],
        video,
        caption,
        interestIds: [],
        tags,
        story: true,
      });
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setProgress(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={() => router.back()} hitSlop={10}>
          <Feather name="x" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          New story
        </Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {photo ? (
          <View>
            <Image
              source={photo.thumbnail ?? { uri: photo.uri }}
              style={[styles.preview, { height: previewHeight }]}
              contentFit="cover"
              accessibilityLabel={video ? 'Your video' : 'Your photo'}
            />
            {video ? (
              <View style={styles.videoBadge} pointerEvents="none">
                <Feather name="play" size={14} color={colors.onInk} />
              </View>
            ) : null}
            {!busy ? (
              <View style={styles.previewActions}>
                <Pressable accessibilityRole="button" onPress={() => setTagging(true)} style={styles.pill}>
                  <Text style={styles.pillShop}>{tags.length ? `${tags.length} tagged` : 'Tag items'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose something else"
                  onPress={() => {
                    setPhoto(null);
                    setVideo(null);
                    setTags([]);
                  }}
                  style={styles.pill}
                >
                  <Text style={styles.pillText}>Change</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.pickers}>
            <Text style={type.bodyMuted}>Stories disappear after 24 hours, unless you keep them in a highlight.</Text>
            <Button label="Choose a photo" onPress={() => void pick('images')} />
            <Button label="Choose a video" variant="secondary" onPress={() => void pick('videos')} />
          </View>
        )}

        {photo ? (
          <>
            <TextInput
              accessibilityLabel="Text on your story"
              style={styles.caption}
              value={caption}
              onChangeText={setCaption}
              onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
              placeholder="Add a line of text (optional)"
              placeholderTextColor={colors.muted}
              maxLength={MAX_STORY_CAPTION}
              multiline
              editable={!busy}
            />
            <MentionSuggestions text={caption} cursor={cursor} onChange={setCaption} />
            <ErrorText>{error}</ErrorText>
            <Button label={progress ?? 'Share to your story'} onPress={() => void share()} loading={busy} />
          </>
        ) : (
          <ErrorText>{error}</ErrorText>
        )}
      </ScrollView>
      <TagEditor
        key={photo?.uri ?? 'none'}
        photo={tagging ? photo : null}
        mediaIndex={0}
        tags={tags}
        remainingForPost={20 - tags.length}
        onChange={(next) => setTags(next)}
        onClose={() => setTagging(false)}
        onDetect={
          video || !photo
            ? undefined
            : async () => {
                const { uploadedPath, items, note } = await detect.mutateAsync(photo);
                setPhoto((p) => (p ? { ...p, uploadedPath } : p));
                return { items, note };
              }
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  spacer: { width: 24 },
  body: { padding: space.lg, gap: space.md },
  pickers: { gap: space.md, paddingTop: space.xl },
  preview: { width: '100%', borderRadius: radius.tag, backgroundColor: colors.wash },
  videoBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewActions: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pill: { backgroundColor: colors.paper, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  pillShop: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ultramarine },
  pillText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  caption: {
    minHeight: 60,
    backgroundColor: colors.wash,
    borderRadius: radius.tag,
    padding: space.md,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    textAlignVertical: 'top',
  },
});
