import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/components/ui';
import type { FeedPost } from './api';
import { fonts } from '@/theme';

export type PostAction = 'insights' | 'edit' | 'collection' | 'untag' | 'story' | 'share' | 'delete' | 'report-post' | 'report-user' | 'block';

export function PostActions({
  post,
  isMine,
  isTagged = false,
  onPick,
  onClose,
}: {
  post: FeedPost | null;
  isMine: boolean;
  /** The viewer is tagged in this post. */
  isTagged?: boolean;
  onPick: (action: PostAction, post: FeedPost) => void;
  onClose: () => void;
}) {
  const actions: { action: PostAction; label: string; danger?: boolean }[] = !post
    ? []
    : isMine
      ? [
          { action: 'insights', label: 'View insights' },
          { action: 'edit', label: 'Edit caption' },
          { action: 'collection', label: 'Save to collection' },
          { action: 'story', label: 'Share to Stories' },
          { action: 'share', label: 'Send in a message' },
          { action: 'delete', label: 'Delete post', danger: true },
        ]
      : [
          { action: 'collection', label: 'Save to collection' },
          ...(isTagged ? [{ action: 'untag' as const, label: 'Remove me from this post' }] : []),
          { action: 'story', label: 'Share to Stories' },
          { action: 'share', label: 'Send in a message' },
          { action: 'report-post', label: 'Report post' },
          { action: 'report-user', label: `Report @${post.author.handle}` },
          { action: 'block', label: `Block @${post.author.handle}`, danger: true },
        ];

  return (
    <Modal visible={!!post} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={styles.sheet} accessibilityViewIsModal>
        {actions.map((a) => (
          <Pressable
            key={a.action}
            accessibilityRole="button"
            style={styles.row}
            onPress={() => {
              onClose();
              if (post) onPick(a.action, post);
            }}
          >
            <Text style={[styles.text, a.danger && styles.danger]}>{a.label}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" style={styles.row} onPress={onClose}>
          <Text style={[styles.text, styles.cancel]}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 32, paddingTop: 8 },
  row: { paddingVertical: 16, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  text: { fontFamily: fonts.body, fontSize: 16, color: colors.text, textAlign: 'center' },
  danger: { color: colors.danger },
  cancel: { color: colors.muted },
});
