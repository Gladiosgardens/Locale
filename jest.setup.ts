process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Avatars load through React Query; screens under test render without a client.
jest.mock('@/features/profiles/avatars', () => ({
  avatarUrl: (path: string | null) => (path ? `https://avatars/${path}` : null),
  loadAvatarPath: jest.fn(async () => null),
  useAvatarUrl: () => null,
}));

// The share sheet target is native; screens under test never receive a share.
jest.mock('expo-share-intent', () => ({
  ShareIntentProvider: ({ children }: { children: unknown }) => children,
  useShareIntentContext: () => ({ hasShareIntent: false, shareIntent: {}, resetShareIntent: jest.fn(), isReady: true, error: null }),
  getShareExtensionKey: () => 'localeShareKey',
}));
