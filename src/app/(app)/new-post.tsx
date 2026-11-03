import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, colors, ErrorText } from '@/components/ui';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';
import { TagEditor } from '@/features/items/TagEditor';
import { MAX_PHOTOS, MAX_POST_INTERESTS, type DraftTag, type PickedPhoto } from '@/features/posts/api';
import { usePublishPost, type PublishStage } from '@/features/posts/hooks';
import { friendlyError } from '@/lib/errors';

const MAX_CAPTION = 2200;
const MAX_POST_TAGS = 20;

function stageText(stage: PublishStage, done: number, total: number) {
  if (stage === 'publishing') return 'Publishing…';
  const n = Math.min(done + 1, total);
  return stage === 'preparing' ? `Preparing photo ${n} of ${total}…` : `Uploading photo ${n} of ${total}…`;
}

export default function NewPost() {
  const { groupId, groupName } = useLocalSearchParams<{ groupId?: string; groupName?: string }>();
  const profile = useMyProfile();
  const interests = useInterests();
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [caption, setCaption] = useState('');
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

  function toggleTag(id: number) {
    setTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : prev.length < MAX_POST_INTERESTS ? [...prev, id] : prev,
    );
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, j) => j !== index));
    // Drop that photo's tags and shift later photos' tags down by one.
    setItemTags((prev) =>
      prev.filter((t) => t.media !== index).map((t) => (t.media > index ? { ...t, media: t.media - 1 } : t)),
    );
  }

  async function submit() {
    setError(null);
    try {
      await publish.mutateAsync({
        photos,
        caption,
        interestIds: tags,
        tags: itemTags,
        // Kid-related posts are never shown outside the area (also enforced server-side).
        searchable: !(nearbyOnly || familySelected),
        groupId: groupId ?? null,
      });
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
              <Image source={{ uri: p.uri }} style={styles.thumb} contentFit="cover" />
              {!busy ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${i + 1}`}
                  style={styles.remove}
                  onPress={() => removePhoto(i)}
                >
                  <Text style={styles.removeText}>×</Text>
                </Pressable>
              ) : null}
              {!busy ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Tag items in photo ${i + 1}`}
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
            </View>
          ))}
          {photos.length < MAX_PHOTOS && !busy ? (
            <Pressable accessibilityRole="button" style={[styles.thumb, styles.add]} onPress={pickPhotos}>
              <Text style={styles.addText}>{photos.length ? '+ More' : '+ Add photos'}</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <TextInput
          accessibilityLabel="Caption"
          style={styles.caption}
          value={caption}
          onChangeText={setCaption}
          placeholder="Say something about it…"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={MAX_CAPTION}
          editable={!busy}
        />

        <Text style={styles.label}>Tags (up to {MAX_POST_INTERESTS})</Text>
        <View style={styles.chips}>
          {(interests.data ?? []).map((i) => (
            <Chip key={i.id} label={i.label} selected={tags.includes(i.id)} onPress={() => !busy && toggleTag(i.id)} />
          ))}
        </View>

        {familySelected && !groupId ? (
          <View style={styles.warning} accessibilityRole="alert">
            <Text style={styles.warningTitle}>Please avoid showing children’s faces</Text>
            <Text style={styles.warningText}>
              This post is public to everyone nearby. Shoot from behind, crop faces out, or share kid photos
              in a members-only group once groups are available.
            </Text>
          </View>
        ) : null}

        {groupId ? (
          <Text style={styles.notice}>
            Only people who can see {groupName ?? 'this group'} will see this post. Group posts never appear in Nearby,
            Everywhere or search.
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

        <ErrorText>{error}</ErrorText>
        {progress ? <Text style={styles.progress}>{progress}</Text> : null}
        <Button label="Post" onPress={submit} disabled={photos.length === 0} loading={busy} />
      </ScrollView>
      <TagEditor
        photo={tagging != null ? photos[tagging] ?? null : null}
        mediaIndex={tagging ?? 0}
        tags={itemTags.filter((t) => t.media === tagging)}
        remainingForPost={MAX_POST_TAGS - itemTags.length}
        onChange={(next) => setItemTags((prev) => [...prev.filter((t) => t.media !== tagging), ...next])}
        onClose={() => setTagging(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  cancel: { color: colors.muted, fontSize: 16, width: 60 },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: colors.text },
  headerSpacer: { width: 60 },
  body: { padding: 16, gap: 14 },
  thumbs: { gap: 10 },
  thumb: { width: 96, height: 96, borderRadius: 10, backgroundColor: colors.chip },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  addText: { color: colors.accent, fontWeight: '600' },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: '#FFFFFF', fontSize: 16, lineHeight: 18 },
  caption: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
  },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  warning: { backgroundColor: '#FFF4E5', borderRadius: 12, padding: 12, gap: 4 },
  warningTitle: { fontWeight: '600', color: '#7A4B00', fontSize: 15 },
  warningText: { color: '#7A4B00', fontSize: 14, lineHeight: 20 },
  tagButton: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    paddingVertical: 3,
    alignItems: 'center',
  },
  tagButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchText: { fontSize: 16, color: colors.text },
  notice: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  progress: { color: colors.muted, fontSize: 14, textAlign: 'center' },
});
