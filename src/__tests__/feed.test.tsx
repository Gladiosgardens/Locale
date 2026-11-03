import { fireEvent, render, screen } from '@testing-library/react-native';
import Feed from '@/app/(app)/index';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';
import { useDeletePost, useFeed } from '@/features/posts/hooks';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/features/auth/api', () => ({ signOut: jest.fn() }));
jest.mock('@/features/onboarding/hooks', () => ({ useInterests: jest.fn(), useMyProfile: jest.fn() }));
jest.mock('@/features/posts/hooks', () => ({ useFeed: jest.fn(), useDeletePost: jest.fn() }));

const post = (id: string, authorId: string, name: string) => ({
  id,
  caption: `Caption ${id}`,
  publishedAt: new Date().toISOString(),
  author: { id: authorId, handle: name.toLowerCase(), displayName: name },
  areaName: 'Downtown',
  media: [{ path: `${id}/0.jpg`, width: 100, height: 100, url: 'https://s/x', tags: [] as unknown[] }],
  interestIds: [1],
  matchedItemIds: [] as string[],
});

function feedResult(overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [[post('p1', 'me', 'Me'), post('p2', 'other', 'Ben')]] },
    isPending: false,
    isError: false,
    isRefetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    refetch: jest.fn(),
    fetchNextPage: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (useInterests as jest.Mock).mockReturnValue({
    data: [
      { id: 1, slug: 'dogs', label: 'Dogs', sort_order: 1, is_family: false },
      { id: 2, slug: 'coffee', label: 'Coffee', sort_order: 2, is_family: false },
    ],
  });
  (useMyProfile as jest.Mock).mockReturnValue({ data: { area: { id: 'a', name: 'Downtown' }, interestIds: [1, 2] } });
  (useDeletePost as jest.Mock).mockReturnValue({ mutate: jest.fn() });
});

describe('Feed', () => {
  it('shows posts with authors, tags and delete only on my own post', async () => {
    (useFeed as jest.Mock).mockReturnValue(feedResult());
    await render(<Feed />);
    expect(screen.getByText('Downtown and around')).toBeTruthy();
    expect(screen.getByText('Caption p1')).toBeTruthy();
    expect(screen.getByText('Caption p2')).toBeTruthy();
    expect(screen.getAllByText('Dogs').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Delete post' })).toHaveLength(1);
  });

  it('filters by one of my interests', async () => {
    (useFeed as jest.Mock).mockReturnValue(feedResult());
    await render(<Feed />);
    expect(useFeed).toHaveBeenLastCalledWith('nearby', null);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Coffee' }));
    expect(useFeed).toHaveBeenLastCalledWith('nearby', 2);
  });

  it('switches to the Everywhere feed, which has no interest filter', async () => {
    (useFeed as jest.Mock).mockReturnValue(feedResult());
    await render(<Feed />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Everywhere' }));
    expect(useFeed).toHaveBeenLastCalledWith('everywhere', null);
    expect(screen.getByText('Public posts from everywhere')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Coffee' })).toBeNull();
  });

  it('shows an empty state that invites the first post', async () => {
    (useFeed as jest.Mock).mockReturnValue(feedResult({ data: { pages: [[]] } }));
    await render(<Feed />);
    expect(screen.getByText(/no posts within about 15 km yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a post' })).toBeTruthy();
  });

  it('shows a retry on error', async () => {
    const refetch = jest.fn();
    (useFeed as jest.Mock).mockReturnValue(feedResult({ data: undefined, isError: true, refetch }));
    await render(<Feed />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });
});
