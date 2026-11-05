import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { refreshPushRegistration, routeFromNotification } from './push';

// Push is phone-only; the web build (used for previews and, later, shared links) skips it.
const SUPPORTED = Platform.OS !== 'web';

if (SUPPORTED) Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Mounted once the user is signed in and onboarded: keeps this device's
// token fresh and opens the right screen when a notification is tapped.
export function useNotificationRouting() {
  useEffect(() => {
    if (!SUPPORTED) return;
    void refreshPushRegistration();

    const open = (data: unknown) => {
      const route = routeFromNotification(data);
      if (route) router.push(route as never);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => sub.remove();
  }, []);
}
