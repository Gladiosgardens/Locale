import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Explore from '@/app/(app)/(tabs)/explore';
import { useFeed, useSearch } from '@/features/posts/hooks';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock('@/features/posts/hooks', () => ({ useSearch: jest.fn(), useFeed: jest.fn(), useRemoveMyTag: () => ({ mutate: jest.fn() }) }));
let mockPeople: unknown[] = [];
jest.mock('@/features/people/hooks', () => ({
  usePeopleSearch: (q: string) => ({ data: q ? mockPeople : undefined }),
  useFollowPerson: () => ({ mutate: jest.fn() }),
}));

const post = (id: string) => ({
  id, caption: null, publishedAt: new Date().toISOString(),
  author: { id: 'u', handle: 'ana', displayName: 'Ana' }, areaName: null, interestIds: [], matchedItemIds: [],
  media: [{ path: `${id}/0.jpg`, width: 800, height: 1000, url: 'https://s/x', tags: [] }],
});
const result = (over: Record<string, unknown> = {}) => ({
  data: { pages: [[]] }, isPending: false, isError: false, isRefetching: false,
  isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPeople = [];
  jest.useFakeTimers();
  (useSearch as jest.Mock).mockReturnValue(result());
  (useFeed as jest.Mock).mockReturnValue(result({ data: { pages: [[post('p1'), post('p2')]] } }));
});
afterEach(() => jest.useRealTimers());

it('shows public posts as a grid before searching', async () => {
  await render(<Explore />);
  expect(useFeed).toHaveBeenCalledWith('everywhere', null);
  expect(screen.getByRole('header', { name: 'Explore' })).toBeTruthy();
  const tiles = screen.getAllByRole('link', { name: 'Post by Ana' });
  expect(tiles).toHaveLength(2);
  await fireEvent.press(tiles[0]);
  expect(mockPush).toHaveBeenCalledWith('/post/p1');
});

it('debounces the query and shows an empty result', async () => {
  await render(<Explore />);
  await fireEvent.changeText(screen.getByLabelText('Search people, items, brands, stores and hashtags'), 'linen');
  expect(useSearch).toHaveBeenLastCalledWith('');
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(useSearch).toHaveBeenLastCalledWith('linen');
  expect(screen.getByText('Nothing tagged “linen” yet.')).toBeTruthy();
});

it('searches a suggestion when tapped', async () => {
  await render(<Explore />);
  await fireEvent.press(screen.getByRole('button', { name: 'Linen' }));
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(useSearch).toHaveBeenLastCalledWith('Linen');
});

it('shows matching people above posts, with a link to all of them', async () => {
  mockPeople = ['a', 'b', 'c', 'd'].map((x) => ({ id: x, handle: `ana_${x}`, displayName: `Ana ${x}`, iFollow: false, note: null }));
  await render(<Explore />);
  await fireEvent.changeText(screen.getByLabelText('Search people, items, brands, stores and hashtags'), 'ana');
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(screen.getByText('People')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^Follow Ana/ })).toHaveLength(3);
  await fireEvent.press(screen.getByRole('button', { name: 'See all people' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/find-friends', params: { q: 'ana' } });
});
