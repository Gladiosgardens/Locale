import { fireEvent, render, screen } from '@testing-library/react-native';
import ProfileScreen from '@/app/(app)/profile/[id]';
import type { Profile } from '@/features/profiles/api';
import { useFollow, useProfile } from '@/features/profiles/hooks';
import { useAuthorFeed } from '@/features/posts/hooks';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'u2' }),
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/features/onboarding/hooks', () => ({ useInterests: () => ({ data: [] }) }));
jest.mock('@/features/profiles/hooks', () => ({ useProfile: jest.fn(), useFollow: jest.fn() }));
jest.mock('@/features/posts/hooks', () => ({ useAuthorFeed: jest.fn(), useDeletePost: () => ({ mutate: jest.fn() }) }));
jest.mock('@/features/safety/hooks', () => ({
  useBlockUser: () => ({ mutate: jest.fn() }),
  useReport: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const profile = (over: Partial<Profile> = {}): Profile => ({
  id: 'u2', handle: 'bex', displayName: 'Bex', bio: 'Plants and coffee', followerCount: 3, followingCount: 5,
  iFollow: false, followsMe: true, isMe: false, ...over,
});

const mutate = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (useFollow as jest.Mock).mockReturnValue({ mutate });
  (useAuthorFeed as jest.Mock).mockReturnValue({
    data: { pages: [[]] }, isPending: false, isRefetching: false, isFetchingNextPage: false,
    hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(),
  });
});

it('shows a profile with counts, follows and opens a message', async () => {
  (useProfile as jest.Mock).mockReturnValue({ isPending: false, data: profile() });
  await render(<ProfileScreen />);
  expect(screen.getByText('Plants and coffee')).toBeTruthy();
  expect(screen.getByText(/Follows you/)).toBeTruthy();
  expect(screen.getByText(/followers/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
  expect(mutate).toHaveBeenCalledWith(true, expect.anything());
  await fireEvent.press(screen.getByRole('button', { name: 'Message' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/messages/new', params: { to: 'u2', name: 'Bex' } });
  expect(screen.getByText('No posts you can see yet.')).toBeTruthy();
});

it('offers unfollow when already following', async () => {
  (useProfile as jest.Mock).mockReturnValue({ isPending: false, data: profile({ iFollow: true }) });
  await render(<ProfileScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Following' }));
  expect(mutate).toHaveBeenCalledWith(false, expect.anything());
});

it('hides follow and message on your own profile', async () => {
  (useProfile as jest.Mock).mockReturnValue({ isPending: false, data: profile({ isMe: true, followsMe: false }) });
  await render(<ProfileScreen />);
  expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Message' })).toBeNull();
});

it('explains when a profile is unavailable (e.g. blocked)', async () => {
  (useProfile as jest.Mock).mockReturnValue({ isPending: false, isError: false, data: null });
  await render(<ProfileScreen />);
  expect(screen.getByText('This profile isn’t available.')).toBeTruthy();
});
