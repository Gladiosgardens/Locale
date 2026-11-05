import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Button, colors, ErrorText, Field, Screen } from '@/components/ui';
import { useCompleteOnboarding } from '@/features/onboarding/hooks';
import { friendlyError } from '@/lib/errors';
import { fonts } from '@/theme';

const HANDLE = /^[a-z0-9_]{3,20}$/;

export default function ProfileStep() {
  const complete = useCompleteOnboarding();
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOk = HANDLE.test(handle);
  const ready = handleOk && displayName.trim().length > 0 && adult;

  async function submit() {
    setError(null);
    try {
      // On success the profile query refreshes and the root guard opens the app.
      await complete.mutateAsync({ handle, displayName: displayName.trim(), confirmAdult: adult });
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  return (
    <Screen title="Set up your profile" subtitle="This is how people will see you on Locale.">
      <Field
        label="Handle"
        value={handle}
        onChangeText={(t) => setHandle(t.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="maya_runs"
      />
      {handle.length > 0 && !handleOk ? (
        <Text style={styles.hint}>3–20 lowercase letters, numbers or underscores.</Text>
      ) : null}
      <Field label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={50} placeholder="Maya" />
      <View style={styles.row}>
        <Switch accessibilityLabel="I am 18 or older" value={adult} onValueChange={setAdult} />
        <Text style={styles.rowText}>I am 18 or older</Text>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button label="Finish" onPress={submit} disabled={!ready} loading={complete.isPending} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontFamily: fonts.body, fontSize: 13, marginTop: -8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { fontFamily: fonts.body, fontSize: 16, color: colors.text },
});
