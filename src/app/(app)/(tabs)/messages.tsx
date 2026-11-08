import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import type { ConversationRow } from '@/features/messages/api';
import { useConversations } from '@/features/messages/hooks';
import { PushPrompt } from '@/features/notifications/PushPrompt';
import { timeAgo } from '@/lib/time';
import { colors, fonts, space, type } from '@/theme';
import { UserAvatar } from '@/features/profiles/UserAvatar';

function Row({ c, request }: { c: ConversationRow; request: boolean }) {
  const preview = c.awaitingReply ? 'Request sent' : c.lastMessage ?? '';
  const unread = c.unread > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${c.otherName}${unread ? `, ${c.unread} unread` : ''}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={() => router.push(`/messages/${c.id}`)}
    >
      <UserAvatar userId={c.otherId} name={c.otherName} size={48} />
      <View style={styles.rowText}>
        <Text style={[styles.name, unread && styles.unreadName]} numberOfLines={1}>
          {c.otherName}
        </Text>
        <Text style={[styles.preview, unread && styles.unreadPreview]} numberOfLines={1}>
          {request ? `Wants to message you: ${preview}` : preview}
        </Text>
      </View>
      <View style={styles.meta}>
        <Text style={styles.time}>{timeAgo(c.lastMessageAt)}</Text>
        {unread ? <View style={styles.unreadDot} accessibilityElementsHidden /> : null}
      </View>
    </Pressable>
  );
}

export default function Inbox() {
  const [tab, setTab] = useState<'inbox' | 'requests'>('inbox');
  const inbox = useConversations(false);
  const requests = useConversations(true);
  const current = tab === 'inbox' ? inbox : requests;
  const requestCount = requests.data?.length ?? 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={[type.title, styles.title]} accessibilityRole="header">
        Messages
      </Text>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['inbox', 'requests'] as const).map((t) => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(t)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {t === 'inbox' ? 'Inbox' : `Requests${requestCount ? ` (${requestCount})` : ''}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <FlatList
        ListHeaderComponent={<PushPrompt />}
        data={current.data ?? []}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <Row c={item} request={tab === 'requests'} />}
        ListEmptyComponent={
          current.isPending ? (
            <ActivityIndicator style={styles.loading} color={colors.ink} />
          ) : current.isError ? (
            <View style={styles.empty}>
              <Text style={type.bodyMuted}>We couldn’t load your messages.</Text>
              <Button label="Try again" variant="secondary" onPress={() => current.refetch()} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={type.bodyMuted}>
                {tab === 'inbox'
                  ? 'No conversations yet. Open someone’s profile and tap Message.'
                  : 'No message requests. Messages from people you’re not connected with land here first.'}
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { paddingHorizontal: space.lg, paddingTop: space.sm },
  tabs: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.wash },
  tabActive: { backgroundColor: colors.ink },
  tabText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  tabTextActive: { color: colors.onInk },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  pressed: { backgroundColor: colors.wash },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  unreadName: { fontFamily: fonts.bold },
  preview: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  unreadPreview: { color: colors.ink },
  meta: { alignItems: 'flex-end', gap: 6 },
  time: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ultramarine },
  loading: { marginVertical: space.xl },
  empty: { padding: space.xl, gap: space.md },
});
