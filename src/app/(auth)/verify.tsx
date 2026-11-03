import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Field, Screen } from '@/components/ui';
import { sendSignInCode, verifySignInCode } from '@/features/auth/api';

export default function Verify() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  if (!email) return <Redirect href="/sign-in" />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // On success the auth listener updates the session and the root guard moves on.
      await verifySignInCode(email, code);
    } catch {
      setError('That code is wrong or expired.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await sendSignInCode(email);
      setResent(true);
    } catch {
      setError('Please wait a minute before requesting another code.');
    }
  }

  return (
    <Screen title="Check your email" subtitle={`Enter the 6-digit code we sent to ${email}.`}>
      <Field
        label="Code"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        placeholder="123456"
        maxLength={6}
      />
      <ErrorText>{error}</ErrorText>
      <Button label="Sign in" onPress={submit} disabled={code.length !== 6} loading={busy} />
      <Button label={resent ? 'Code sent again' : 'Resend code'} variant="secondary" onPress={resend} disabled={resent} />
    </Screen>
  );
}
