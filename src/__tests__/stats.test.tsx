import { act, fireEvent, render, screen } from '@testing-library/react-native';
import PostInsights from '@/app/(app)/insights/[postId]';
import Insights from '@/app/(app)/insights/index';
import { ItemSheet } from '@/features/items/ItemSheet';
import { resetViewTracking, trackView } from '@/features/stats/api';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useLocalSearchParams: () => ({ postId: 'p1' }),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/features/posts/hooks', () => ({
  usePost: () => ({
    data: { id: 'p1', caption: 'Desk day', publishedAt: new Date().toISOString(), media: [{ url: null }] },
  }),
  useSimilarItems: () => ({ data: undefined, isPending: false }),
}));
jest.mock('@/features/social/hooks', () => ({
  useItemSaved: () => ({ data: false }),
  useSaveItem: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/features/earnings/hooks', () => ({
  useEarnings: () => ({ data: { availableCents: 1250, pendingCents: 700 } }),
  usePostEarnings: () => ({ data: { sales: 3, earnedCents: 2100 } }),
}));
jest.mock('@/features/stats/hooks', () => ({
  useSummary: (days: number) => ({
    isPending: false,
    isError: false,
    data: {
      reach: days * 10,
      likes: 12,
      comments: 3,
      saves: 4,
      itemOpens: 9,
      linkTaps: 5,
      newFollowers: 2,
      posts: [{ postId: 'p1', reach: 120, likes: 12, linkTaps: 5 }],
    },
  }),
  usePostStats: () => ({
    isPending: false,
    isError: false,
    data: {
      reach: 120,
      views: 150,
      likes: 12,
      comments: 3,
      saves: 4,
      itemOpens: 9,
      linkTaps: 5,
      items: [
        { itemId: 'i1', title: 'Oak desk', urlHost: 'shop.com', opens: 7, linkTaps: 5, wishlist: 2 },
        { itemId: 'i2', title: 'Lamp', urlHost: null, opens: 2, linkTaps: 0, wishlist: 0 },
      ],
    },
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ data: null, error: null });
  resetViewTracking();
});

describe('view tracking', () => {
  it('batches views and sends each post once per session', async () => {
    jest.useFakeTimers();
    trackView('p1');
    trackView('p2');
    trackView('p1');
    expect(mockRpc).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(4100);
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('record_post_views', { p_post_ids: ['p1', 'p2'] });
    trackView('p1');
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

describe('item events', () => {
  const item = {
    id: 'i1',
    title: 'Oak desk',
    brand: null,
    storeName: null,
    url: 'https://shop.com/d',
    urlHost: 'shop.com',
    priceCents: null,
    currency: null,
    isAffiliate: false,
  };
  it('records opening an item and tapping through to the shop', async () => {
    await render(<ItemSheet item={item} postId="p1" onClose={jest.fn()} />);
    expect(mockRpc).toHaveBeenCalledWith('record_item_event', { p_post_id: 'p1', p_item_id: 'i1', p_kind: 'open' });
    await fireEvent.press(screen.getByRole('button', { name: 'Shop on shop.com' }));
    expect(mockRpc).toHaveBeenCalledWith('record_item_event', { p_post_id: 'p1', p_item_id: 'i1', p_kind: 'link' });
  });
});

describe('Insights', () => {
  it('shows the summary for a period and opens a top post', async () => {
    await render(<Insights />);
    expect(screen.getByLabelText('300 accounts reached')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Earnings: $12.50 ready, $7.00 pending' }));
    expect(mockPush).toHaveBeenCalledWith('/earnings');
    expect(screen.getByLabelText('5 taps to shops')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Last 7 days' }));
    expect(screen.getByLabelText('70 accounts reached')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Desk day: 120 reached, 12 likes, 5 taps to shops/ }));
    expect(mockPush).toHaveBeenCalledWith('/insights/p1');
  });

  it('breaks a post down by tagged item', async () => {
    await render(<PostInsights />);
    expect(screen.getByLabelText('150 views')).toBeTruthy();
    expect(screen.getByLabelText('3 sales')).toBeTruthy();
    expect(screen.getByLabelText('$21.00 earned')).toBeTruthy();
    expect(screen.getByLabelText('Oak desk: 7 views, 5 taps to shop, 2 wishlist saves')).toBeTruthy();
    expect(screen.getByText('2 views, no link')).toBeTruthy();
  });
});
