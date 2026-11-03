import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { check } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const TOKEN_KEY = 'locale.pushToken';

export type EnableResult = 'enabled' | 'denied' | 'unsupported' | 'not_configured';

// Only routes the app actually has, so a malformed payload can't send people anywhere odd.
const ALLOWED_ROUTE = /^\/(messages|groups)\/[0-9a-f-]{36}$/;

export function routeFromNotification(data: unknown): string | null {
  const url = (data as { url?: unknown } | null)?.url;
  return typeof url === 'string' && ALLOWED_ROUTE.test(url) ? url : null;
}

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

async function registerThisDevice(): Promise<EnableResult> {
  const id = projectId();
  if (!id) return 'not_configured';
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
  check(await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS === 'ios' ? 'ios' : 'android' }));
  await AsyncStorage.setItem(TOKEN_KEY, token);
  return 'enabled';
}

export async function getPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (!Device.isDevice) return 'denied';
  const { status } = await Notifications.getPermissionsAsync();
  return status as 'granted' | 'denied' | 'undetermined';
}

// Ask (if needed) and register this device. Called from an explicit button.
export async function enablePush(): Promise<EnableResult> {
  if (!Device.isDevice) return 'unsupported';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Messages and groups',
      importance: AndroidImportance.HIGH,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return 'denied';
  return registerThisDevice();
}

// On app start: tokens can rotate, so re-register if permission was already given. Never prompts.
export async function refreshPushRegistration(): Promise<void> {
  try {
    if ((await getPermission()) === 'granted') await registerThisDevice();
  } catch {
    // Best effort; the next launch retries.
  }
}

// Before signing out, so this device stops receiving the account's notifications.
export async function unregisterThisDevice(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) {
      await supabase.rpc('unregister_push_token', { p_token: token });
      await AsyncStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Signing out must never fail because of this.
  }
}
