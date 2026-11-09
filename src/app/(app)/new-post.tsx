import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, colors, ErrorText } from '@/components/ui';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';
import { TagEditor } from '@/features/items/TagEditor';
import { MentionSuggestions } from '@/features/people/MentionSuggestions';
import { MAX_PEOPLE_TAGS, PeopleTagEditor } from '@/features/people/PeopleTagEditor';
import { groupBySection } from '@/features/onboarding/sections';
import {
  MAX_CAPTION,
  MAX_PHOTOS,
  MAX_POST_INTERESTS,
  setPeopleTags,
  type DraftTag,
  type PeopleTagDraft,
  type PickedPhoto,
  type PickedVideo,
} from '@/features/posts/api';
import { MAX_VIDEO_MS } from '@/features/video/mux';
import { createVideoPlayer } from 'expo-video';
import { useDetectItems, usePublishPost, type PublishStage } from '@/features/posts/hooks';
import { usePrivateSettings } from '@/features/settings/hooks';
import { friendlyError } from '@/lib/errors';
import { LOCAL_FEATURES } from '@/lib/features';
import { fonts, radius, space } from '@/theme';

const MAX_POST_TAGS = 20;

function stageText(stage: PublishStage, done: number, total: number) {
  if (stage === 'publishing') return 'Publishing…';
  if (stage === 'processing') return 'Getting your video ready…';
  const n = Math.min(done + 1, total);
  return stage === 'preparing' ? `Preparing photo ${n} of ${total}…` : `Uploading photo ${n} of ${total}…`;
}

export default function NewPost() {
  const { groupId, groupName } = useLocalSearchParams<{ groupId?: string; groupName?: string }>();
  const profile = useMyProfile();
  const interests = useInterests();
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  // A post is photos or one video. The video's poster frame stands in as photo 0 for tagging.
  const [video, setVideo] = useState<PickedVideo | null>(null);
  // "Show shopping on this post": off means no tags, no links, no detection.
  const settings = usePrivateSettings();
  const [shoppingChoice, setShoppingChoice] = useState<boolean | null>(null);
  const shopping = shoppingChoice ?? settings.query.data?.shoppingDefault ?? true;
  const detectMut = useDetectItems();
  const [caption, setCaption] = useState('');
  const [captionCursor, setCaptionCursor] = useState(0);
  const [people, setPeople] = useState<PeopleTagDraft[]>([]);
  const [taggingPeople, setTaggingPeople] = useState<number | null>(null);
  const [tags, setTags] = useState<number[]>([]);
  const [itemTags, setItemTags] = useState<DraftTag[]>([]);
  const [tagging, setTagging] = useState<number | null>(null);
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const publish = usePublishPost((stage, done, total) => setProgress(stageText(stage, done, total)));

  const familySelected = useMemo(
    () => tags.some((id) => interests.data?.find((i) => i.id === id)?.is_family),
    [tags, interests.data],
  );

  async function pickPhotos() {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
      orderedSelection: true,
      exif: false,
      quality: 1,
    });
    if (result.canceled) return;
    const picked = result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
    setPhotos((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
  }

  async function pickVideo() {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: true, // iOS shows a trimmer
      videoMaxDuration: 60,
      quality: 1,
    });
    if (result.canceled) return;
    const a = result.assets[0];
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
      thumbnail = undefined; // tagging still works without a preview frame
    }
    setVideo({ uri: a.uri, width: a.width, height: a.height, durationMs: a.duration ?? 0 });
    setPhotos([{ uri: a.uri, width: a.width, height: a.height, thumbnail }]);
    setItemTags([]);
    setPeople([]);
  }

  function toggleTag(id: number) {
    setTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : prev.length < MAX_POST_INTERESTS ? [...prev, id] : prev,
    );
  }

  function removePhoto(index: number) {
    if (video) setVideo(null);
    setPhotos((prev) => prev.filter((_, j) => j !== index));
    // Drop that photo's tags and shift later photos' tags down by one.
    setItemTags((prev) =>
      prev.filter((t) => t.media !== index).map((t) => (t.media > index ? { ...t, media: t.media - 1 } : t)),
    );
    setPeople((prev) =>
      prev
        .filter((t) => t.position !== index)
        .map((t) => (t.position > index ? { ...t, position: t.position - 1 } : t)),
    );
  }

  async function submit() {
    setError(null);
    try {
      const postId = await publish.mutateAsync({
        photos: video ? [] : photos,
        video,
        caption,
        interestIds: tags,
        tags: shopping ? itemTags : [],
        shopping,
        // Kid-related posts are never shown outside the area (also enforced server-side).
        searchable: !(nearbyOnly || familySelected),
        groupId: groupId ?? null,
      });
      if (people.length) {
        try {
          await setPeopleTags(postId, people);
        } catch (e) {
          Alert.alert('Posted, but the people tags didn’t save', friendlyError(e));
        }
      }
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setProgress(null);
    }
  }

  const busy = publish.isPending;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} disabled={busy} hitSlop={8}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {groupName ? `Post in ${groupName}` : 'New post'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
          {photos.map((p, i) => (
            <View key={`${p.uri}-${i}`}>
              <Image
                source={p.thumbnail ?? (video ? undefined : { uri: p.uri })}
                style={styles.thumb}
                contentFit="cover"
              />
              {video ? (
                <View style={styles.videoBadge} pointerEvents="none">
                  <Text style={styles.videoBadgeText}>{`Video, ${Math.round(video.durationMs / 1000)}s`}</Text>
                </View>
              ) : null}
              {!busy ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={video ? 'Remove video' : `Remove photo ${i + 1}`}
                  style={styles.remove}
                  onPress={() => removePhoto(i)}
                >
                  <Text style={styles.removeText}>×</Text>
                </Pressable>
              ) : null}
              {!busy && shopping ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={video ? 'Tag items in the video' : `Tag items in photo ${i + 1}`}
                  style={styles.tagButton}
                  onPress={() => setTagging(i)}
                >
                  <Text style={styles.tagButtonText}>
                    {(() => {
                      const n = itemTags.filter((t) => t.media === i).length;
                      return n ? `${n} tagged` : 'Tag items';
                    })()}
                  </Text>
                </Pressable>
              ) : null}
              {!busy ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={video ? 'Tag people in the video' : `Tag people in photo ${i + 1}`}
                  style={[styles.tagButton, styles.peopleButton]}
                  onPress={() => setTaggingPeople(i)}
                >
                  <Text style={[styles.tagButtonText, styles.peopleButtonText]}>
                    {(() => {
                      const n = people.filter((t) => t.position === i).length;
                      return n ? `${n} ${n === 1 ? 'person' : 'people'}` : 'Tag people';
                    })()}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {photos.length === 0 && !busy ? (
            <Pressable accessibilityRole="button" style={[styles.thumb, styles.add]} onPress={pickVideo}>
              <Text style={styles.addText}>Add a video</Text>
              <Text style={styles.addHint}>Up to 60s</Text>
            </Pressable>
          ) : null}
          {!video && photos.length < MAX_PHOTOS && !busy ? (
            <Pressable accessibilityRole="button" style={[styles.thumb, styles.add]} onPress={pickPhotos}>
              <Text style={styles.addText}>{photos.length ? 'Add more' : 'Add photos'}</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <TextInput
          accessibilityLabel="Caption"
          style={styles.caption}
          value={caption}
          onChangeText={setCaption}
          onSelectionChange={(e) => setCaptionCursor(e.nativeEvent.selection.end)}
          placeholder="Write a caption, @mention people, add #hashtags"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={MAX_CAPTION}
          editable={!busy}
        />
        <MentionSuggestions text={caption} cursor={captionCursor} onChange={setCaption} />

        <Text style={styles.label}>Topics, up to {MAX_POST_INTERESTS}</Text>
        {groupBySection(interests.data ?? []).map((g) => (
          <View key={g.key} style={styles.topicGroup}>
            <Text style={styles.topicSection}>{g.label}</Text>
            <View style={styles.chips}>
              {g.items.map((i) => (
                <Chip
                  key={i.id}
                  label={i.label}
                  selected={tags.includes(i.id)}
                  onPress={() => !busy && toggleTag(i.id)}
                />
              ))}
            </View>
          </View>
        ))}

        {familySelected && !groupId && LOCAL_FEATURES ? (
          <View style={styles.warning} accessibilityRole="alert">
            <Text style={styles.warningTitle}>Please avoid showing children’s faces</Text>
            <Text style={styles.warningText}>
              This post is public to everyone nearby. Shoot from behind, crop faces out, or share kid photos in a
              members-only group once groups are available.
            </Text>
          </View>
        ) : null}

        {groupId ? (
          <Text style={styles.notice}>
            Only people who can see {groupName ?? 'this group'} will see this post. Group posts never appear in Nearby,
            Everywhere or search.
          </Text>
        ) : !LOCAL_FEATURES ? (
          <Text style={styles.notice}>
            Public: anyone on Locale can see this post, and the items you tag show up in search.
          </Text>
        ) : (
          <>
            <View style={styles.switchRow}>
              <Switch
                accessibilityLabel="Nearby only"
                value={nearbyOnly || familySelected}
                onValueChange={setNearbyOnly}
                disabled={familySelected || busy}
                accessibilityState={{ disabled: familySelected || busy, checked: nearbyOnly || familySelected }}
              />
              <Text style={styles.switchText}>Nearby only</Text>
            </View>
            <Text style={styles.notice}>
              {familySelected
                ? `Posts with kid-related tags are only shown within about 15 km of ${profile.data?.area?.name ?? 'your area'}.`
                : nearbyOnly
                  ? `Only people within about 15 km of ${profile.data?.area?.name ?? 'your area'} will see this.`
                  : `Public: shown nearby, in Everywhere and in item search. Only people near ${profile.data?.area?.name ?? 'you'} see your area name.`}
            </Text>
          </>
        )}

        <View style={styles.switchRow}>
          <Switch
            accessibilityLabel="Show shopping on this post"
            value={shopping}
            onValueChange={setShoppingChoice}
            disabled={busy}
          />
          <Text style={styles.switchText}>Show shopping on this post</Text>
        </View>
        <Text style={styles.notice}>
          {shopping
            ? 'Tagged items and where to buy them appear on the post.'
            : 'No tags or shop links will appear on this post, and it won’t be scanned for items.'}
        </Text>

        <ErrorText>{error}</ErrorText>
        {progress ? <Text style={styles.progress}>{progress}</Text> : null}
        <Button label="Post" onPress={submit} disabled={photos.length === 0} loading={busy} />
      </ScrollView>
      <PeopleTagEditor
        photo={taggingPeople != null ? (photos[taggingPeople] ?? null) : null}
        position={taggingPeople ?? 0}
        tags={people.filter((t) => t.position === taggingPeople)}
        remaining={MAX_PEOPLE_TAGS - people.length}
        onChange={(next) => setPeople((prev) => [...prev.filter((t) => t.position !== taggingPeople), ...next])}
        onClose={() => setTaggingPeople(null)}
      />
      <TagEditor
        // A fresh editor for each photo, so one photo's detection never shows on another.
        key={tagging != null ? `${tagging}:${photos[tagging]?.uri}` : 'closed'}
        photo={tagging != null ? (photos[tagging] ?? null) : null}
        mediaIndex={tagging ?? 0}
        tags={itemTags.filter((t) => t.media === tagging)}
        remainingForPost={MAX_POST_TAGS - itemTags.length}
        onChange={(next) => setItemTags((prev) => [...prev.filter((t) => t.media !== tagging), ...next])}
        onClose={() => setTagging(null)}
        onDetect={
          shopping && !video && tagging != null
            ? async () => {
                const index = tagging;
                const { uploadedPath, items, note } = await detectMut.mutateAsync(photos[index]);
                // Remember the upload so publishing doesn't upload this photo again.
                setPhotos((prev) => prev.map((p, i) => (i === index ? { ...p, uploadedPath } : p)));
                return { items, note };
              }
            : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md },
  cancel: { fontFamily: fonts.medium, color: colors.ink, fontSize: 15, width: 60 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  headerSpacer: { width: 60 },
  body: { padding: space.lg, gap: space.lg },
  thumbs: { gap: space.sm },
  thumb: { width: 112, height: 140, borderRadius: radius.tag, backgroundColor: colors.wash },
  add: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.ink,
    borderStyle: 'dashed',
  },
  addText: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 14 },
  addHint: { fontFamily: fonts.body, color: colors.muted, fontSize: 12, marginTop: 2 },
  videoBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: colors.ink,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  videoBadgeText: { fontFamily: fonts.semibold, color: colors.onInk, fontSize: 11 },
  remove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: colors.ink, fontSize: 16, lineHeight: 18 },
  caption: {
    minHeight: 90,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
    paddingVertical: space.md,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  topicGroup: { gap: space.sm },
  topicSection: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  warning: { backgroundColor: colors.wash, borderRadius: radius.tag, padding: space.md, gap: 4 },
  warningTitle: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 15 },
  warningText: { fontFamily: fonts.body, color: colors.graphite, fontSize: 14, lineHeight: 20 },
  tagButton: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    backgroundColor: colors.paper,
    borderRadius: 999,
    paddingVertical: 4,
    alignItems: 'center',
  },
  tagButtonText: { fontFamily: fonts.semibold, color: colors.ultramarine, fontSize: 12 },
  // Sits above "Tag items"; people tags aren't shopping, so they stay black.
  peopleButton: { bottom: 34 },
  peopleButtonText: { color: colors.ink },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  switchText: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  notice: { fontFamily: fonts.body, color: colors.muted, fontSize: 13, lineHeight: 18 },
  progress: { fontFamily: fonts.body, color: colors.muted, fontSize: 14, textAlign: 'center' },
});
