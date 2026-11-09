import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '@/components/ui';
import { UserAvatar } from '@/features/profiles/UserAvatar';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/time';
import { colors, fonts, radius, space, type } from '@/theme';
import { useAddToHighlight, useMyHighlights, useStoryViewers } from './hooks';

function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet} accessibilityViewIsModal>
        {children}
      </View>
    </Modal>
  );
}

// Who has seen my story.
export function ViewersSheet({ storyId, onClose }: { storyId: string | null; onClose: () => void }) {
  return (
    <Sheet visible={!!storyId} onClose={onClose}>
      {storyId ? <ViewerList storyId={storyId} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ViewerList({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const viewers = useStoryViewers(storyId);
  const list = viewers.data ?? [];
  return (
    <>
      <Text style={type.title} accessibilityRole="header">
        {viewers.data ? `Seen by ${list.length}` : 'Viewers'}
      </Text>
      {viewers.isPending ? <ActivityIndicator color={colors.ink} /> : null}
      {viewers.data && !list.length ? <Text style={type.bodyMuted}>Nobody has seen this story yet.</Text> : null}
      <ScrollView style={styles.list}>
        {list.map((v) => (
          <Pressable
            key={v.id}
            accessibilityRole="link"
            onPress={() => {
              onClose();
              router.push(`/profile/${v.id}`);
            }}
            style={styles.row}
          >
            <UserAvatar userId={v.id} name={v.displayName} size={36} />
            <View style={styles.rowText}>
              <Text style={styles.name}>{v.handle}</Text>
              <Text style={styles.meta}>{v.displayName}</Text>
            </View>
            <Text style={styles.meta}>{timeAgo(v.viewedAt)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Button label="Close" variant="quiet" onPress={onClose} />
    </>
  );
}

// Keep my story in a highlight on my profile.
export function HighlightSheet({ storyId, onClose }: { storyId: string | null; onClose: () => void }) {
  return (
    <Sheet visible={!!storyId} onClose={onClose}>
      {storyId ? <HighlightPicker storyId={storyId} onClose={onClose} /> : null}
    </Sheet>
  );
}

function HighlightPicker({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const highlights = useMyHighlights(storyId);
  const add = useAddToHighlight();
  const [name, setName] = useState('');
  const done = { onSuccess: onClose, onError: (e: unknown) => Alert.alert(friendlyError(e)) };
  return (
    <>
      <Text style={type.title} accessibilityRole="header">
        Add to highlight
      </Text>
      <Text style={type.small}>Highlights stay on your profile after the story’s 24 hours are up.</Text>
      {highlights.isPending ? <ActivityIndicator color={colors.ink} /> : null}
      <ScrollView style={styles.list}>
        {(highlights.data ?? []).map((h) => (
          <Pressable
            key={h.id}
            accessibilityRole="button"
            accessibilityState={{ disabled: h.hasStory }}
            disabled={h.hasStory || add.isPending}
            onPress={() => add.mutate({ storyId, target: { id: h.id } }, done)}
            style={styles.row}
          >
            <View style={styles.cover}>
              <Feather name={h.hasStory ? 'check' : 'plus'} size={18} color={colors.ink} />
            </View>
            <Text style={[styles.name, styles.rowText]}>{h.name}</Text>
            {h.hasStory ? <Text style={styles.meta}>Added</Text> : null}
          </Pressable>
        ))}
      </ScrollView>
      <TextInput
        accessibilityLabel="New highlight name"
        style={styles.input}
        value={name}
        onChangeText={setName}
        maxLength={30}
        placeholder="New highlight, e.g. Desk, Summer"
        placeholderTextColor={colors.muted}
      />
      <Button
        label="Create highlight"
        onPress={() => add.mutate({ storyId, target: { name } }, done)}
        disabled={!name.trim()}
        loading={add.isPending}
      />
      <Button label="Cancel" variant="quiet" onPress={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: space.xl,
    paddingBottom: 40,
    gap: space.md,
  },
  list: { maxHeight: 320 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8 },
  rowText: { flex: 1 },
  name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: colors.wash,
    borderRadius: radius.tag,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
});
