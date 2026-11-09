import { Stack } from 'expo-router';
import { useNotificationRouting } from '@/features/notifications/useNotificationRouting';

export default function Layout() {
  useNotificationRouting();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="new-post" options={{ presentation: 'modal' }} />
      <Stack.Screen name="post/[id]" />
      <Stack.Screen name="find-friends" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="activity" />
      <Stack.Screen name="new-story" options={{ presentation: 'modal' }} />
      <Stack.Screen name="stories/view" options={{ animation: 'fade', gestureEnabled: true }} />
      <Stack.Screen name="tag/[tag]" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="comments/[postId]" />
      <Stack.Screen name="qr" options={{ presentation: 'modal' }} />
      <Stack.Screen name="u/[handle]" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="profile/[id]" />
      <Stack.Screen name="messages/[id]" />
      <Stack.Screen name="messages/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="messages/share" options={{ presentation: 'modal' }} />
      <Stack.Screen name="groups/index" />
      <Stack.Screen name="groups/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="groups/[id]" />
    </Stack>
  );
}
