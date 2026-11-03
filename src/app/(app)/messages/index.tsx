import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors } from '@/components/ui';
import type { ConversationRow } from '@/features/messages/api';
import { useConversations } from '@/features/messages/hooks';
import { PushPrompt } from '@/features/notifications/PushPrompt';
import { timeAgo } from '@/lib/time';

function Row({ c, request }: { c: ConversationRow; request: boolean }) {
  const preview = c.awaitingReply ? 'Request sent' : c.lastMessage ?? '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${c.otherName}${c.unread ? `, ${c.unread} unread` : ''}`}
      style={styles.row}
      onPress={() => router.push(`/messages/${c.id}`)}
    >
      <View style={styles.rowText}>
        <Text style={[styles.name, c.unread > 0 && styles.unreadName]}>
          {c.otherName} <Text style={styles.handle}>@{c.otherHandle}</Text>
        </Text>
        <Text style={[styles.preview, c.unread > 0 && styles.unreadPreview]} numberOfLines={1}>
          {request ? `Wants to message you: ${preview}` : preview}
        </Text>
      </View>
      <View style={styles.meta}>
        <Text style={styles.time}>{timeAgo(c.lastMessageAt)}</Text>
        {c.unread > 0 ? <Text style={styles.badge}>{c.unread}</Text> : null}
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
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">Messages</Text>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['inbox', 'requests'] as const).map((t) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} hitSlop={6}>
            <Text style={[styles.tab, tab === t && styles.tabActive]}>
              {t === 'inbox' ? 'Inbox' : `Requests${requestCount ? ` (${requestCount})` : ''}`}
            </Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        ListHeaderComponent={<PushPrompt />}
        data={current.data ?? []}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <Row c={item} request={tab === 'requests'} />}
        ListEmptyComponent={
          current.isPending ? (
            <ActivityIndicator style={styles.loading} color={colors.accent} />
          ) : current.isError ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>We couldn’t load your messages.</Text>
              <Button label="Try again" variant="secondary" onPress={() => current.refetch()} />
            </View>
          ) : (
            <Text style={[styles.emptyText, styles.empty]}>
              {tab === 'inbox'
                ? 'No conversations yet. Open someone’s profile and tap Message.'
                : 'No message requests. Messages from people you’re not connected with land here first.'}
            </Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  link: { color: colors.muted, fontSize: 15 },
  tabs: { flexDirection: 'row', gap: 20, paddingHorizontal: 16, paddingBottom: 10 },
  tab: { fontSize: 16, fontWeight: '600', color: colors.border },
  tabActive: { color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, color: colors.text },
  unreadName: { fontWeight: '700' },
  handle: { fontSize: 13, color: colors.muted, fontWeight: '400' },
  preview: { fontSize: 14, color: colors.muted },
  unreadPreview: { color: colors.text },
  meta: { alignItems: 'flex-end', gap: 4 },
  time: { fontSize: 12, color: colors.muted },
  badge: { minWidth: 20, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.accentText, backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  loading: { marginVertical: 24 },
  empty: { padding: 24, gap: 12 },
  emptyText: { fontSize: 15, color: colors.muted, lineHeight: 21 },
});
