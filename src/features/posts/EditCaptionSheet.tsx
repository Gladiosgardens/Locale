import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, radius, space, type } from '@/theme';
import { MAX_CAPTION, type FeedPost } from './api';
import { useUpdateCaption } from './hooks';

export function EditCaptionSheet({ post, onClose }: { post: FeedPost | null; onClose: () => void }) {
  return (
    <Modal visible={!!post} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      {/* Keyed by post so the field starts from that post's caption. */}
      {post ? <Editor key={post.id} post={post} onClose={onClose} /> : null}
    </Modal>
  );
}

function Editor({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const [text, setText] = useState(post.caption ?? '');
  const update = useUpdateCaption();

  function save() {
    update.mutate(
      { id: post.id, caption: text },
      { onSuccess: onClose, onError: (e) => Alert.alert(friendlyError(e)) },
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.sheet} accessibilityViewIsModal>
        <Text style={type.title} accessibilityRole="header">
          Edit caption
        </Text>
        <TextInput
          accessibilityLabel="Caption"
          style={styles.input}
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          maxLength={MAX_CAPTION}
          placeholder="Write a caption"
          placeholderTextColor={colors.muted}
        />
        <Text style={styles.count}>
          {text.length}/{MAX_CAPTION}
        </Text>
        <Button label="Save caption" onPress={save} loading={update.isPending} />
        <Button label="Cancel" variant="quiet" onPress={onClose} />
      </View>
    </KeyboardAvoidingView>
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
  input: {
    minHeight: 110,
    maxHeight: 220,
    backgroundColor: colors.wash,
    borderRadius: radius.tag,
    padding: space.md,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  count: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textAlign: 'right' },
});
