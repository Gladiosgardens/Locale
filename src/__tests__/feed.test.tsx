import { fireEvent, render, screen } from '@testing-library/react-native';
import Feed from '@/app/(app)/(tabs)/home';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';
import { useDeletePost, useFeed } from '@/features/posts/hooks';

const mockPush = jest.fn();
jest.mock('@/features/stories/hooks', () => ({
  useStoryTray: () => ({ data: [] }),
  useStories: () => ({ data: undefined }),
  useProfileHighlights: () => ({ data: [] }),
  useDeleteHighlight: () => ({ mutate: jest.fn() }),
}));
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/features/auth/api', () => ({ signOut: jest.fn() }));
jest.mock('@/features/onboarding/hooks', () => ({ useInterests: jest.fn(), useMyProfile: jest.fn() }));
const mockLike = jest.fn();
const mockSave = jest.fn();
jest.mock('@/features/posts/hooks', () => ({
  useFeed: jest.fn(),
  useDeletePost: jest.fn(),
  useLikePost: () => ({ mutate: mockLike }),
  useSavePost: () => ({ mutate: mockSave }),
  useSimilarItems: () => ({ data: undefined, isPending: false }),
  useUpdateCaption: () => ({ mutate: mockUpdateCaption, isPending: false }),
  useFilteredFeed: () => ({ data: { pages: [[]] }, isPending: false, isError: false, isRefetching: false, isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn() }),
  useRemoveMyTag: () => ({ mutate: jest.fn() }),
}));
const mockUpdateCaption = jest.fn();
let mockUnread = 0;
jest.mock('@/features/activity/hooks', () => ({ useActivityUnread: () => ({ data: mockUnread }) }));
jest.mock('@/features/social/hooks', () => ({
  useItemSaved: () => ({ data: false }),
  useSaveItem: () => ({ mutate: jest.fn() }),
}));

let mockFollowing = 4;
jest.mock('@/features/profiles/hooks', () => ({ useProfile: () => ({ data: { followingCount: mockFollowing } }) }));
jest.mock('@/features/messages/hooks', () => ({
  useConversations: (requests: boolean) => ({ data: requests ? [{ id: 'r1' }] : [{ id: 'c1', unread: 2 }] }),
}));
jest.mock('@/features/safety/hooks', () => ({
  useBlockUser: () => ({ mutate: jest.fn() }),
  useReport: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const post = (id: string, authorId: string, name: string) => ({
  id,
  caption: `Caption ${id}`,
  publishedAt: new Date().toISOString(),
  author: { id: authorId, handle: name.toLowerCase(), displayName: name },
  areaName: 'Downtown',
  media: [{ path: `${id}/0.jpg`, width: 100, height: 100, url: 'https://s/x', tags: [] as unknown[], people: [] }],
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
  mockFollowing = 4;
  mockUnread = 0;
  (useInterests as jest.Mock).mockReturnValue({
    data: [
      { id: 1, slug: 'dogs', label: 'Dogs', sort_order: 1, is_family: false, section: 'everyday' },
      { id: 3, slug: 'menswear', label: 'Menswear', sort_order: 3, is_family: false, section: 'style' },
      { id: 2, slug: 'coffee', label: 'Coffee', sort_order: 2, is_family: false, section: 'food' },
    ],
  });
  (useMyProfile as jest.Mock).mockReturnValue({ data: { area: { id: 'a', name: 'Downtown' }, interestIds: [1, 2] } });
  (useDeletePost as jest.Mock).mockReturnValue({ mutate: jest.fn() });
});

const tagged = () => {
  const p = post('p3', 'other', 'Ben');
  const item = {
    id: 'i1', title: 'Linen shirt', brand: 'Arket', storeName: null, url: 'https://arket.com/x', urlHost: 'arket.com',
    priceCents: 6900, currency: 'USD', isAffiliate: false,
  };
  p.media[0].tags = [{ id: 't1', x: 0.5, y: 0.5, item }];
  p.interestIds = [3];
  return p;
};

describe('Feed', () => {
  it('opens on For you, with posts, authors and tags; delete for mine, report/block for others', async () => {
    (useFeed as jest.Mock).mockReturnValue(feedResult());
    await render(<Feed />);
    expect(useFeed).toHaveBeenLastCalledWith('for-you', null);
    expect(screen.getByRole('tab', { name: 'For you', selected: true })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Nearby' })).toBeNull();
    expect(screen.getByText(/Caption p1/)).toBeTruthy();
    expect(screen.getByText(/Caption p2/)).toBeTruthy();
    expect(screen.getAllByText('Dogs').length).toBeGreaterThan(0);
    const menus = screen.getAllByRole('button', { name: 'Post options' });
    expect(menus).toHaveLength(2);
    await fireEvent.press(menus[0]);
    expect(screen.getByRole('button', { name: 'Delete post' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit caption' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View insights' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Block/ })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.press(menus[1]);
    expect(screen.getByRole('button', { name: 'Block @ben' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Report post' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete post' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.press(screen.getByRole('link', { name: 'Open Ben’s profile' }));
    expect(mockPush).toHaveBeenCalledWith('/profile/other');
  });

  it('edits the caption of your own post', async () => {
    (useFeed as jest.Mock).mockReturnValue(feedResult());
    await render(<Feed />);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Post options' })[0]);
    await fireEvent.press(screen.getByRole('button', { name: 'Edit caption' }));
    expect(screen.getByLabelText('Caption').props.value).toBe('Caption p1');
    await fireEvent.changeText(screen.getByLabelText('Caption'), 'New words');
    await fireEvent.press(screen.getByRole('button', { name: 'Save caption' }));
    expect(mockUpdateCaption).toHaveBeenCalledWith({ id: 'p1', caption: 'New words' }, expect.anything());
  });

  it('shows new activity on the heart and opens it', async () => {
    (useFeed as jest.Mock).mockReturnValue(feedResult());
    mockUnread = 12;
    await render(<Feed />);
    expect(screen.getByText('9+')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Activity, 12 new' }));
    expect(mockPush).toHaveBeenCalledWith('/activity');
  });

  it('shows tagged items as a Shop the look strip that opens the item', async () => {
    (useFeed as jest.Mock).mockReturnValue(feedResult({ data: { pages: [[tagged()]] } }));
    await render(<Feed />);
    expect(screen.getByText('Shop the look')).toBeTruthy();
    expect(screen.queryByText('Shop this')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Linen shirt, Arket, $69.00' }));
    expect(screen.getByRole('button', { name: 'Shop on arket.com' })).toBeTruthy();
  });

  it('has a Following tab with its own empty state', async () => {
    (useFeed as jest.Mock).mockReturnValue(feedResult({ data: { pages: [[]] } }));
    await render(<Feed />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Following' }));
    expect(useFeed).toHaveBeenLastCalledWith('following', null);
    expect(screen.getByText(/Posts from people you follow show up here/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Find friends' }));
    expect(mockPush).toHaveBeenCalledWith('/find-friends');
  });

  it('shows an empty state that invites the first post', async () => {
    (useFeed as jest.Mock).mockReturnValue(feedResult({ data: { pages: [[]] } }));
    await render(<Feed />);
    expect(screen.getByText('Start the feed')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create a post' }));
    expect(mockPush).toHaveBeenCalledWith('/new-post');
  });

  it('invites people who follow nobody to find friends, and can be dismissed', async () => {
    mockFollowing = 0;
    (useFeed as jest.Mock).mockReturnValue(feedResult());
    await render(<Feed />);
    expect(screen.getByText('Find your friends')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Find' }));
    expect(mockPush).toHaveBeenCalledWith('/find-friends');
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Find your friends')).toBeNull();
  });

  it('shows a retry on error', async () => {
    const refetch = jest.fn();
    (useFeed as jest.Mock).mockReturnValue(feedResult({ data: undefined, isError: true, refetch }));
    await render(<Feed />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });
});
