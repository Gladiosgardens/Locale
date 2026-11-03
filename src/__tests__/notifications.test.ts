import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { enablePush, routeFromNotification, unregisterThisDevice } from '@/features/notifications/push';
import { supabase } from '@/lib/supabase';

let mockIsDevice = true;
let mockProjectId: string | undefined = 'proj-123';
jest.mock('expo-device', () => ({ get isDevice() { return mockIsDevice; } }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { get expoConfig() { return { extra: { eas: { projectId: mockProjectId } } }; }, easConfig: null },
}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const n = Notifications as jest.Mocked<typeof Notifications>;

beforeEach(async () => {
  jest.clearAllMocks();
  mockIsDevice = true;
  mockProjectId = 'proj-123';
  await AsyncStorage.clear();
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: null, data: null });
  (n.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[abc123def456]' });
});

describe('routeFromNotification', () => {
  it('only opens known in-app routes', () => {
    const id = '6f1c0d3e-0000-4000-8000-000000000001';
    expect(routeFromNotification({ url: `/messages/${id}` })).toBe(`/messages/${id}`);
    expect(routeFromNotification({ url: `/groups/${id}` })).toBe(`/groups/${id}`);
    expect(routeFromNotification({ url: 'https://evil.example' })).toBeNull();
    expect(routeFromNotification({ url: '/settings' })).toBeNull();
    expect(routeFromNotification(null)).toBeNull();
  });
});

describe('enablePush', () => {
  it('asks, registers the device token and remembers it', async () => {
    (n.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (n.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    await expect(enablePush()).resolves.toBe('enabled');
    expect(n.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
    expect(supabase.rpc).toHaveBeenCalledWith('register_push_token', {
      p_token: 'ExponentPushToken[abc123def456]',
      p_platform: 'ios',
    });
    expect(await AsyncStorage.getItem('locale.pushToken')).toBe('ExponentPushToken[abc123def456]');
  });

  it('reports a refusal without registering', async () => {
    (n.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (n.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    await expect(enablePush()).resolves.toBe('denied');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('explains a missing EAS project id', async () => {
    mockProjectId = undefined;
    (n.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    await expect(enablePush()).resolves.toBe('not_configured');
  });

  it('does nothing on a simulator', async () => {
    mockIsDevice = false;
    await expect(enablePush()).resolves.toBe('unsupported');
    expect(n.getPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('unregisterThisDevice', () => {
  it('removes this device’s token from the account', async () => {
    await AsyncStorage.setItem('locale.pushToken', 'ExponentPushToken[abc123def456]');
    await unregisterThisDevice();
    expect(supabase.rpc).toHaveBeenCalledWith('unregister_push_token', { p_token: 'ExponentPushToken[abc123def456]' });
    expect(await AsyncStorage.getItem('locale.pushToken')).toBeNull();
  });

  it('never throws, even if the server call fails', async () => {
    await AsyncStorage.setItem('locale.pushToken', 'ExponentPushToken[abc123def456]');
    (supabase.rpc as jest.Mock).mockRejectedValue(new Error('offline'));
    await expect(unregisterThisDevice()).resolves.toBeUndefined();
  });
});
