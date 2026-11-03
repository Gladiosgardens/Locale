import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="new-post" options={{ presentation: 'modal' }} />
      <Stack.Screen name="search" />
      <Stack.Screen name="groups/index" />
      <Stack.Screen name="groups/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="groups/[id]" />
    </Stack>
  );
}
