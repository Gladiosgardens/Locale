import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Search from '@/app/(app)/search';
import { useSearch } from '@/features/posts/hooks';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/features/onboarding/hooks', () => ({ useInterests: () => ({ data: [] }) }));
jest.mock('@/features/posts/hooks', () => ({ useSearch: jest.fn(), useDeletePost: () => ({ mutate: jest.fn() }) }));
jest.mock('@/features/safety/hooks', () => ({
  useBlockUser: () => ({ mutate: jest.fn() }),
  useReport: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const result = (over: Record<string, unknown> = {}) => ({
  data: { pages: [[]] }, isPending: false, isError: false, isRefetching: false,
  isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(), ...over,
});

beforeEach(() => {
  jest.useFakeTimers();
  (useSearch as jest.Mock).mockReturnValue(result());
});
afterEach(() => jest.useRealTimers());

it('prompts before typing and debounces the query', async () => {
  await render(<Search />);
  expect(screen.getByText(/Search items, brands or stores/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Search items'), 'linen');
  expect(useSearch).toHaveBeenLastCalledWith('');
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(useSearch).toHaveBeenLastCalledWith('linen');
  expect(screen.getByText(/No tagged items match “linen”/)).toBeTruthy();
});
