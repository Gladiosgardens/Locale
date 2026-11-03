import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, Centered, colors } from '@/components/ui';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { signOut } from '@/features/auth/api';
import { useMyProfile } from '@/features/onboarding/hooks';
import { queryClient } from '@/lib/queryClient';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, loading } = useAuth();
  const profile = useMyProfile();
  const signedIn = !!session;

  if (loading || (signedIn && profile.isPending)) {
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  }

  if (signedIn && profile.isError) {
    return (
      <Centered>
        <Text>We couldn’t load your profile.</Text>
        <Button label="Try again" onPress={() => profile.refetch()} />
        <Button label="Sign out" variant="secondary" onPress={signOut} />
      </Centered>
    );
  }

  const onboarded = !!profile.data?.onboarded_at;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
