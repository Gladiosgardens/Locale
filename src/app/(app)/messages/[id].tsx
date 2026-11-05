import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Centered, colors } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import type { Message } from '@/features/messages/api';
import { Composer } from '@/features/messages/Composer';
import {
  useConversation,
  useLiveMessages,
  useMarkRead,
  useMessages,
  useRespondToMessageRequest,
  useSendMessage,
} from '@/features/messages/hooks';
import { useBlockUser } from '@/features/safety/hooks';
import { ReportSheet, type ReportSubject } from '@/features/safety/ReportSheet';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/time';
import { fonts } from '@/theme';

function Bubble({ m, mine, onLongPress }: { m: Message; mine: boolean; onLongPress: () => void }) {
  return (
    <Pressable
      onLongPress={mine || m.removed ? undefined : onLongPress}
      accessibilityHint={mine || m.removed ? undefined : 'Long press to report'}
      style={[styles.bubble, mine ? styles.mine : styles.theirs]}
    >
      {m.removed ? (
        <Text style={styles.removed}>Message removed</Text>
      ) : (
        <>
          {m.sharedPost ? (
            m.sharedPost.unavailable ? (
              <Text style={styles.removed}>Post unavailable</Text>
            ) : (
              <View style={styles.shared}>
                {m.sharedPost.imageUrl ? (
                  <Image source={{ uri: m.sharedPost.imageUrl }} style={styles.sharedImage} contentFit="cover" />
                ) : null}
                <Text style={styles.sharedMeta}>@{m.sharedPost.authorHandle}</Text>
                {m.sharedPost.caption ? <Text style={styles.sharedCaption} numberOfLines={2}>{m.sharedPost.caption}</Text> : null}
              </View>
            )
          ) : null}
          {m.body ? <Text style={[styles.body, mine && styles.mineText]}>{m.body}</Text> : null}
        </>
      )}
      <Text style={[styles.time, mine && styles.mineTime]}>{timeAgo(m.createdAt)}</Text>
    </Pressable>
  );
}

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const conversation = useConversation(id);
  const messages = useMessages(id);
  const send = useSendMessage();
  const respond = useRespondToMessageRequest(id);
  const block = useBlockUser();
  const markRead = useMarkRead();
  const [reporting, setReporting] = useState<ReportSubject | null>(null);
  useLiveMessages(id);

  const list = useMemo(() => messages.data?.pages.flat() ?? [], [messages.data]);
  const newest = list[0]?.id;
  const c = conversation.data;
  const isRequest = c?.myState === 'request';

  // Mark as read whenever a newer message is on screen (not while it's still a request).
  const { mutate: markReadMutate } = markRead;
  useEffect(() => {
    if (id && newest && !isRequest) markReadMutate(id);
  }, [id, newest, isRequest, markReadMutate]);

  if (conversation.isPending) {
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  }
  if (!c) {
    return (
      <Centered>
        <Text style={styles.muted}>This conversation isn’t available.</Text>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </Centered>
    );
  }

  const fail = (e: unknown) => Alert.alert(friendlyError(e));

  async function onSend(body: string) {
    try {
      await send.mutateAsync({ conversationId: c!.id, body });
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  function blockThem() {
    Alert.alert(`Block @${c!.otherHandle}?`, 'You won’t see each other’s posts, profiles or messages. They won’t be told.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => block.mutate(c!.otherId, { onSuccess: () => router.back(), onError: fail }),
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Pressable style={styles.headerText} accessibilityRole="link" onPress={() => router.push(`/profile/${c.otherId}`)}>
          <Text style={styles.title} numberOfLines={1}>{c.otherName}</Text>
          <Text style={styles.muted}>@{c.otherHandle}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={blockThem} hitSlop={8}>
          <Text style={styles.danger}>Block</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {isRequest ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {c.otherName} isn’t connected with you and wants to send you messages. They won’t know you’ve seen this
              unless you accept.
            </Text>
            <View style={styles.bannerActions}>
              <View style={styles.flex}>
                <Button label="Accept" loading={respond.isPending} onPress={() => respond.mutate(true, { onError: fail })} />
              </View>
              <View style={styles.flex}>
                <Button
                  label="Delete"
                  variant="secondary"
                  onPress={() => respond.mutate(false, { onSuccess: () => router.back(), onError: fail })}
                />
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setReporting({ type: 'profile', id: c.otherId, label: `@${c.otherHandle}` })}
            >
              <Text style={styles.reportLink}>Report @{c.otherHandle}</Text>
            </Pressable>
          </View>
        ) : null}

        <FlatList
          inverted
          data={list}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Bubble
              m={item}
              mine={item.senderId === session?.user.id}
              onLongPress={() =>
                Alert.alert('Report this message?', 'Reviewers will see this one message.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Report', style: 'destructive', onPress: () => setReporting({ type: 'message', id: item.id, label: 'message' }) },
                ])
              }
            />
          )}
          onEndReached={() => {
            if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
          }}
          ListEmptyComponent={messages.isPending ? <ActivityIndicator color={colors.accent} /> : undefined}
        />

        {c.awaitingReply ? (
          <Text style={styles.waiting}>
            Request sent. You can send more once {c.otherName} accepts.
          </Text>
        ) : isRequest ? null : (
          <Composer onSend={onSend} sending={send.isPending} />
        )}
      </KeyboardAvoidingView>
      <ReportSheet subject={reporting} onClose={() => setReporting(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  headerText: { flex: 1 },
  title: { fontFamily: fonts.semibold, fontSize: 17, color: colors.text },
  link: { color: colors.muted, fontFamily: fonts.body, fontSize: 15  },
  danger: { color: colors.danger, fontFamily: fonts.body, fontSize: 14  },
  muted: { color: colors.muted, fontFamily: fonts.body, fontSize: 13  },
  banner: { margin: 12, padding: 12, borderRadius: 12, backgroundColor: '#FFF4E5', gap: 10 },
  bannerText: { color: '#7A4B00', fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  bannerActions: { flexDirection: 'row', gap: 10 },
  reportLink: { color: '#7A4B00', fontFamily: fonts.body, fontSize: 13, textDecorationLine: 'underline' },
  list: { padding: 12, gap: 6 },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.accent },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.text, lineHeight: 21 },
  mineText: { color: colors.accentText },
  time: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, alignSelf: 'flex-end' },
  mineTime: { color: 'rgba(255,255,255,0.75)' },
  removed: { fontFamily: fonts.body, fontSize: 14, fontStyle: 'italic', color: colors.muted },
  shared: { gap: 4, backgroundColor: colors.chip, borderRadius: 10, padding: 6 },
  sharedImage: { width: 200, height: 200, borderRadius: 8 },
  sharedMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  sharedCaption: { fontFamily: fonts.body, fontSize: 13, color: colors.text },
  waiting: { padding: 16, textAlign: 'center', fontFamily: fonts.body, fontSize: 14, color: colors.muted, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
