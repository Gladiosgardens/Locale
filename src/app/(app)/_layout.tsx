import { Stack } from 'expo-router';
import { useNotificationRouting } from '@/features/notifications/useNotificationRouting';

export default function Layout() {
  useNotificationRouting();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="home" />
      <Stack.Screen name="new-post" options={{ presentation: 'modal' }} />
      <Stack.Screen name="search" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="profile/[id]" />
      <Stack.Screen name="messages/index" />
      <Stack.Screen name="messages/[id]" />
      <Stack.Screen name="messages/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="messages/share" options={{ presentation: 'modal' }} />
      <Stack.Screen name="groups/index" />
      <Stack.Screen name="groups/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="groups/[id]" />
    </Stack>
  );
}
