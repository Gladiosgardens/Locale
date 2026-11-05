import {
  BodoniModa_500Medium_Italic,
  BodoniModa_600SemiBold,
  BodoniModa_700Bold,
} from '@expo-google-fonts/bodoni-moda';
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans';
import Feather from '@expo/vector-icons/Feather';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, Centered, colors } from '@/components/ui';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { signOut } from '@/features/auth/api';
import { useMyProfile } from '@/features/onboarding/hooks';
import { queryClient } from '@/lib/queryClient';
import { type } from '@/theme';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BodoniModa_500Medium_Italic,
    BodoniModa_600SemiBold,
    BodoniModa_700Bold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    ...Feather.font,
  });
  // Fonts are bundled, so this is a few frames. If they fail, carry on with system fonts.
  if (!fontsLoaded && !fontError) return null;

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
        <ActivityIndicator color={colors.ink} />
      </Centered>
    );
  }

  if (signedIn && profile.isError) {
    return (
      <Centered>
        <Text style={type.body}>We couldn’t load your profile.</Text>
        <Button label="Try again" onPress={() => profile.refetch()} />
        <Button label="Sign out" variant="secondary" onPress={signOut} />
      </Centered>
    );
  }

  const onboarded = !!profile.data?.onboarded_at;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
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
