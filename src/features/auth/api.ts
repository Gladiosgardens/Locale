import { supabase } from '@/lib/supabase';

export async function sendSignInCode(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function verifySignInCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  // Imported lazily so the auth module doesn't pull in native notification code at startup.
  const { unregisterThisDevice } = await import('@/features/notifications/push');
  await unregisterThisDevice();
  await supabase.auth.signOut();
}
