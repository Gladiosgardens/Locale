import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, colors } from '@/components/ui';
import { enablePush, getPermission, type EnableResult } from './push';
import { fonts } from '@/theme';

const RESULT_MESSAGE: Record<Exclude<EnableResult, 'enabled'>, string> = {
  denied: 'Notifications are off for Locale. You can turn them on in your phone’s Settings.',
  unsupported: 'Notifications need a real phone, not a simulator.',
  not_configured: 'Notifications aren’t set up for this build of the app yet.',
};

export function usePushPermission() {
  return useQuery({ queryKey: ['push-permission'], queryFn: getPermission });
}

export function useEnablePush() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function enable() {
    setBusy(true);
    try {
      const result = await enablePush();
      if (result !== 'enabled') Alert.alert(RESULT_MESSAGE[result]);
    } catch {
      Alert.alert('We couldn’t turn on notifications. Please try again.');
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['push-permission'] });
    }
  }
  return { enable, busy };
}

// Asks in context (from Messages), never cold at launch.
export function PushPrompt() {
  const permission = usePushPermission();
  const { enable, busy } = useEnablePush();
  if (permission.data !== 'undetermined') return null;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Know when someone messages you</Text>
      <Text style={styles.body}>We’ll only say who it’s from, never what the message says.</Text>
      <Button label="Turn on notifications" onPress={enable} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { margin: 16, padding: 14, borderRadius: 14, backgroundColor: colors.chip, gap: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, lineHeight: 20 },
});
