import { act, screen } from '@testing-library/react-native';
import { Redirect, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { useSyncExternalStore } from 'react';
import { Text } from 'react-native';

// A tiny external store so a test can sign in / finish onboarding mid-render,
// the way the real auth listener and profile query do.
let state = { signedIn: false, onboarded: false };
const listeners = new Set<() => void>();
const store = {
  set(next: Partial<typeof state>) {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
const useAppState = () => useSyncExternalStore(store.subscribe, () => state);

// Mirrors src/app: an unguarded index that redirects, plus three guarded groups.
const Group = () => <Stack />;
const routes = {
  _layout: function Root() {
    const { signedIn, onboarded } = useAppState();
    return (
      <Stack>
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
  },
  index: function Start() {
    const { signedIn, onboarded } = useAppState();
    if (!signedIn) return <Redirect href="/sign-in" />;
    if (!onboarded) return <Redirect href="/area" />;
    return <Redirect href="/home" />;
  },
  '(auth)/_layout': Group,
  '(auth)/sign-in': () => <Text>SIGN_IN</Text>,
  '(onboarding)/_layout': Group,
  '(onboarding)/area': () => <Text>AREA</Text>,
  '(app)/_layout': Group,
  '(app)/home': () => <Text>FEED</Text>,
};

beforeEach(() => store.set({ signedIn: false, onboarded: false }));

it('signed out at launch: shows sign-in, not "unmatched route"', async () => {
  await renderRouter(routes, { initialUrl: '/' });
  expect(await screen.findByText('SIGN_IN')).toBeTruthy();
  expect(screen.queryByTestId('expo-router-unmatched')).toBeNull();
});

it('signed in but not onboarded at launch: shows onboarding', async () => {
  store.set({ signedIn: true });
  await renderRouter(routes, { initialUrl: '/' });
  expect(await screen.findByText('AREA')).toBeTruthy();
});

it('onboarded at launch: shows the feed', async () => {
  store.set({ signedIn: true, onboarded: true });
  await renderRouter(routes, { initialUrl: '/' });
  expect(await screen.findByText('FEED')).toBeTruthy();
});

it('signing in, then finishing onboarding, moves you along', async () => {
  await renderRouter(routes, { initialUrl: '/' });
  expect(await screen.findByText('SIGN_IN')).toBeTruthy();
  await act(async () => store.set({ signedIn: true }));
  expect(await screen.findByText('AREA')).toBeTruthy();
  await act(async () => store.set({ onboarded: true }));
  expect(await screen.findByText('FEED')).toBeTruthy();
  expect(screen.queryByTestId('expo-router-unmatched')).toBeNull();
});

it('signing out from the feed returns to sign-in', async () => {
  store.set({ signedIn: true, onboarded: true });
  await renderRouter(routes, { initialUrl: '/' });
  expect(await screen.findByText('FEED')).toBeTruthy();
  await act(async () => store.set({ signedIn: false, onboarded: false }));
  expect(await screen.findByText('SIGN_IN')).toBeTruthy();
});

it('a notification link into the app works when onboarded', async () => {
  store.set({ signedIn: true, onboarded: true });
  await renderRouter(routes, { initialUrl: '/home' });
  expect(await screen.findByText('FEED')).toBeTruthy();
});
