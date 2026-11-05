import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/components/ui';
import { Composer } from '@/features/messages/Composer';
import { useMessageStatus, useSendMessage } from '@/features/messages/hooks';
import { friendlyError } from '@/lib/errors';
import { fonts } from '@/theme';

export default function NewMessage() {
  const { to, name } = useLocalSearchParams<{ to: string; name?: string }>();
  const status = useMessageStatus(to);
  const send = useSendMessage();
  const who = name ?? 'them';

  if (status.data?.status === 'existing' && status.data.conversationId) {
    return <Redirect href={`/messages/${status.data.conversationId}`} />;
  }

  async function onSend(body: string) {
    try {
      const conversationId = await send.mutateAsync({ to, body });
      router.replace(`/messages/${conversationId}`);
      return true;
    } catch (e) {
      Alert.alert(friendlyError(e));
      return false;
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>Message {who}</Text>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.flex}>
          {status.isPending ? (
            <ActivityIndicator style={styles.loading} color={colors.accent} />
          ) : status.data?.status === 'closed' || status.isError ? (
            <Text style={styles.notice}>{who} only accepts messages from people they’re connected with.</Text>
          ) : status.data?.status === 'request' ? (
            <Text style={styles.notice}>
              You’re not connected with {who} yet, so this goes to their message requests. You can send one message until
              they accept. Following each other or sharing a group makes you connected.
            </Text>
          ) : null}
        </View>
        {status.data && (status.data.status === 'direct' || status.data.status === 'request') ? (
          <Composer onSend={onSend} sending={send.isPending} placeholder={`Message ${who}…`} />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 10 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 18, color: colors.text },
  link: { color: colors.muted, fontFamily: fonts.body, fontSize: 15  },
  loading: { marginTop: 24 },
  notice: { margin: 16, padding: 12, borderRadius: 12, backgroundColor: colors.chip, fontFamily: fonts.body, fontSize: 14, color: colors.text, lineHeight: 20 },
});
