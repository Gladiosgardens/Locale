import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button } from '@/components/ui';
import { ReportSheet, type ReportSubject } from '@/features/safety/ReportSheet';
import { MAX_COMMENT, type Comment } from '@/features/social/api';
import { useAddComment, useComments, useDeleteComment } from '@/features/social/hooks';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/time';
import { colors, fonts, radius, space, type } from '@/theme';

function CommentRow({ c, onMore }: { c: Comment; onMore: (c: Comment) => void }) {
  return (
    <Pressable
      onLongPress={() => onMore(c)}
      style={styles.row}
      accessibilityLabel={`${c.author.displayName}: ${c.body}`}
      accessibilityActions={[{ name: 'more', label: c.canDelete ? 'Delete comment' : 'Report comment' }]}
      onAccessibilityAction={() => onMore(c)}
    >
      <Pressable onPress={() => router.push(`/profile/${c.author.id}`)} accessibilityRole="link" hitSlop={4}>
        <Avatar name={c.author.displayName} size={34} />
      </Pressable>
      <View style={styles.rowText}>
        <Text style={styles.body}>
          <Text style={styles.handle}>{c.author.handle} </Text>
          {c.body}
        </Text>
        <Text style={styles.time}>{timeAgo(c.createdAt)}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Comment options" onPress={() => onMore(c)} hitSlop={10}>
        <Feather name="more-horizontal" size={18} color={colors.muted} />
      </Pressable>
    </Pressable>
  );
}

export default function Comments() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const comments = useComments(postId);
  const add = useAddComment(postId);
  const remove = useDeleteComment(postId);
  const [text, setText] = useState('');
  const [reporting, setReporting] = useState<ReportSubject | null>(null);
  const list = useMemo(() => comments.data?.pages.flat() ?? [], [comments.data]);
  const canSend = text.trim().length > 0 && text.length <= MAX_COMMENT && !add.isPending;

  function send() {
    if (!canSend) return;
    add.mutate(text, { onSuccess: () => setText(''), onError: (e) => Alert.alert(friendlyError(e)) });
  }

  function more(c: Comment) {
    if (c.canDelete) {
      Alert.alert('Delete this comment?', undefined, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => remove.mutate(c.id, { onError: (e) => Alert.alert(friendlyError(e)) }),
        },
      ]);
    } else {
      setReporting({ type: 'comment', id: c.id, label: 'comment' });
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Comments
        </Text>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          style={styles.flex}
          data={list}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <CommentRow c={item} onMore={more} />}
          onEndReached={() => {
            if (comments.hasNextPage && !comments.isFetchingNextPage) void comments.fetchNextPage();
          }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            comments.isPending ? (
              <ActivityIndicator style={styles.loading} color={colors.ink} />
            ) : comments.isError ? (
              <View style={styles.empty}>
                <Text style={type.bodyMuted}>We couldn’t load the comments.</Text>
                <Button label="Try again" variant="secondary" onPress={() => comments.refetch()} />
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={type.bodyMuted}>No comments yet. Ask where something’s from, or just say you love it.</Text>
              </View>
            )
          }
        />
        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="Add a comment"
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Add a comment"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={MAX_COMMENT}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Post comment"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={send}
            hitSlop={8}
          >
            {add.isPending ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <Text style={[styles.post, !canSend && styles.postDisabled]}>Post</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <ReportSheet subject={reporting} onClose={() => setReporting(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1 },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  rowText: { flex: 1, gap: 3 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  handle: { fontFamily: fonts.semibold },
  time: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  loading: { marginVertical: space.xl },
  empty: { padding: space.xl, gap: space.md },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.wash,
    borderRadius: radius.sheet,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  post: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ultramarine },
  postDisabled: { color: colors.muted },
});
