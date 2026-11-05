import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorText, Field } from '@/components/ui';
import { sendSignInCode } from '@/features/auth/api';
import { colors, fonts, space, type } from '@/theme';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = EMAIL.test(email.trim());

  async function submit() {
    setSending(true);
    setError(null);
    try {
      await sendSignInCode(email);
      router.push({ pathname: '/verify', params: { email: email.trim().toLowerCase() } });
    } catch {
      setError("We couldn't send a code. Check the address and try again in a minute.");
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.masthead}>
          <Text style={styles.wordmark} accessibilityRole="header">
            Locale
          </Text>
          <Text style={styles.tagline}>See it. Tap it. Wear it.</Text>
          <Text style={[type.bodyMuted, styles.lede]}>
            Outfits and rooms from real people, with every piece tagged so you can find where it’s from.
          </Text>
        </View>
        <View style={styles.form}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
            returnKeyType="send"
            onSubmitEditing={() => valid && submit()}
          />
          <ErrorText>{error}</ErrorText>
          <Button label="Continue with email" onPress={submit} disabled={!valid} loading={sending} />
          <Text style={styles.fine}>We’ll email you a 6-digit code. No password needed.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1, paddingHorizontal: space.xl, justifyContent: 'space-between' },
  masthead: { flex: 1, justifyContent: 'center' },
  wordmark: { fontFamily: fonts.displayItalic, fontSize: 84, lineHeight: 92, letterSpacing: -2.5, color: colors.ink },
  tagline: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.ink, marginTop: space.xs },
  lede: { marginTop: space.lg, maxWidth: 340 },
  form: { gap: space.lg, paddingBottom: space.xl, maxWidth: 480, width: '100%', alignSelf: 'center' },
  fine: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textAlign: 'center' },
});
