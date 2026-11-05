import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/components/ui';
import { useConversations, useSendMessage } from '@/features/messages/hooks';
import { friendlyError } from '@/lib/errors';
import { fonts } from '@/theme';

export default function SharePost() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const conversations = useConversations(false);
  const send = useSendMessage();

  async function shareTo(conversationId: string, name: string) {
    try {
      await send.mutateAsync({ conversationId, sharedPostId: postId });
      Alert.alert(`Sent to ${name}`);
      router.back();
    } catch (e) {
      Alert.alert(friendlyError(e));
    }
  }

  const sendable = (conversations.data ?? []).filter((c) => !c.awaitingReply);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">Send post to…</Text>
      </View>
      <Text style={styles.note}>They’ll only see it if the post is visible to them.</Text>
      <FlatList
        data={sendable}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Send to ${item.otherName}`}
            style={styles.row}
            disabled={send.isPending}
            onPress={() => shareTo(item.id, item.otherName)}
          >
            <Text style={styles.name}>
              {item.otherName} <Text style={styles.handle}>@{item.otherHandle}</Text>
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          conversations.isPending ? (
            <ActivityIndicator style={styles.loading} color={colors.accent} />
          ) : (
            <Text style={styles.empty}>No conversations yet. Open someone’s profile and tap Message first.</Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text },
  link: { color: colors.muted, fontFamily: fonts.body, fontSize: 15  },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, paddingHorizontal: 16, paddingBottom: 8 },
  row: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  name: { fontFamily: fonts.body, fontSize: 16, color: colors.text },
  handle: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  loading: { marginVertical: 24 },
  empty: { padding: 24, fontFamily: fonts.body, fontSize: 15, color: colors.muted, lineHeight: 21 },
});
