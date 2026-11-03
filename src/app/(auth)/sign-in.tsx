import { router } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Field, Screen } from '@/components/ui';
import { sendSignInCode } from '@/features/auth/api';

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
    <Screen title="Welcome to Locale" subtitle="Meet people nearby who share your interests. We'll email you a sign-in code.">
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
      <Button label="Send code" onPress={submit} disabled={!valid} loading={sending} />
    </Screen>
  );
}
