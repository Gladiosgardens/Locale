import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { type ComponentRef, useMemo, useRef, useState } from 'react';
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
import { RichText } from '@/components/RichText';
import { Button } from '@/components/ui';
import { MentionSuggestions } from '@/features/people/MentionSuggestions';
import { ReportSheet, type ReportSubject } from '@/features/safety/ReportSheet';
import { MAX_COMMENT, threadComments, type Comment } from '@/features/social/api';
import { useAddComment, useComments, useDeleteComment, useLikeComment } from '@/features/social/hooks';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/time';
import { colors, fonts, radius, space, type } from '@/theme';
import { UserAvatar } from '@/features/profiles/UserAvatar';

type Row = Comment & { isReply: boolean };

function CommentRow({
  c,
  onMore,
  onReply,
  onLike,
}: {
  c: Row;
  onMore: (c: Comment) => void;
  onReply: (c: Comment) => void;
  onLike: (c: Comment) => void;
}) {
  return (
    <Pressable
      onLongPress={() => onMore(c)}
      style={[styles.row, c.isReply && styles.reply]}
      accessibilityLabel={`${c.isReply ? 'Reply from ' : ''}${c.author.displayName}: ${c.body}${c.likeCount ? `, ${c.likeCount} likes` : ''}`}
      accessibilityActions={[
        { name: 'like', label: c.iLiked ? 'Unlike' : 'Like' },
        { name: 'reply', label: 'Reply' },
        { name: 'more', label: c.canDelete ? 'Delete comment' : 'Report comment' },
      ]}
      onAccessibilityAction={(e) =>
        e.nativeEvent.actionName === 'like' ? onLike(c) : e.nativeEvent.actionName === 'reply' ? onReply(c) : onMore(c)
      }
    >
      <Pressable onPress={() => router.push(`/profile/${c.author.id}`)} accessibilityRole="link" hitSlop={4}>
        <UserAvatar userId={c.author.id} name={c.author.displayName} size={c.isReply ? 26 : 34} />
      </Pressable>
      <View style={styles.rowText}>
        <Text style={styles.body}>
          <Text style={styles.handle}>{c.author.handle} </Text>
          <RichText text={c.body} />
        </Text>
        <View style={styles.meta}>
          <Text style={styles.time}>{timeAgo(c.createdAt)}</Text>
          {c.likeCount ? <Text style={styles.time}>{c.likeCount === 1 ? '1 like' : `${c.likeCount} likes`}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`Reply to ${c.author.handle}`} onPress={() => onReply(c)} hitSlop={8}>
            <Text style={styles.replyLink}>Reply</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Comment options" onPress={() => onMore(c)} hitSlop={8}>
            <Feather name="more-horizontal" size={16} color={colors.muted} />
          </Pressable>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={c.iLiked ? 'Unlike comment' : 'Like comment'}
        accessibilityState={{ selected: c.iLiked }}
        onPress={() => onLike(c)}
        hitSlop={10}
        style={styles.heart}
      >
        <Feather name="heart" size={15} color={c.iLiked ? colors.ultramarine : colors.muted} />
      </Pressable>
    </Pressable>
  );
}

export default function Comments() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const comments = useComments(postId);
  const add = useAddComment(postId);
  const remove = useDeleteComment(postId);
  const like = useLikeComment(postId);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [cursor, setCursor] = useState(0);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [reporting, setReporting] = useState<ReportSubject | null>(null);
  const list = useMemo(() => threadComments(comments.data?.pages.flat() ?? []), [comments.data]);
  const canSend = text.trim().length > 0 && text.length <= MAX_COMMENT && !add.isPending;

  function send() {
    if (!canSend) return;
    // Replies stay one level deep: replying to a reply answers its parent thread.
    const parentId = replyTo ? (replyTo.parentId ?? replyTo.id) : null;
    add.mutate(
      { body: text, parentId },
      {
        onSuccess: () => {
          setText('');
          setReplyTo(null);
        },
        onError: (e) => Alert.alert(friendlyError(e)),
      },
    );
  }

  function reply(c: Comment) {
    setReplyTo(c);
    setText((t) => (t.trim() ? t : `@${c.author.handle} `));
    input.current?.focus();
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
          renderItem={({ item }) => (
            <CommentRow
              c={item}
              onMore={more}
              onReply={reply}
              onLike={(c) => like.mutate({ id: c.id, like: !c.iLiked })}
            />
          )}
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
        <MentionSuggestions text={text} cursor={cursor} onChange={setText} />
        {replyTo ? (
          <View style={styles.replying}>
            <Text style={styles.time}>Replying to @{replyTo.author.handle}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel reply"
              onPress={() => {
                setReplyTo(null);
                setText((t) => (t.trim() === `@${replyTo.author.handle}` ? '' : t));
              }}
              hitSlop={10}
            >
              <Feather name="x" size={16} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.composer}>
          <TextInput
            ref={input}
            accessibilityLabel={replyTo ? `Write a reply to ${replyTo.author.handle}` : 'Add a comment'}
            style={styles.input}
            value={text}
            onChangeText={setText}
            onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
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
  reply: { paddingLeft: space.lg + 34 + space.md },
  rowText: { flex: 1, gap: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  replyLink: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted },
  heart: { paddingTop: 4 },
  replying: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: 6,
    backgroundColor: colors.wash,
  },
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
