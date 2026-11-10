import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { Alert } from 'react-native';
import Earnings from '@/app/(app)/earnings';
import { ItemSheet } from '@/features/items/ItemSheet';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(), openAuthSessionAsync: jest.fn() }));
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: jest.fn(async () => ({ data: null, error: null })),
  },
}));
jest.mock('@/features/posts/hooks', () => ({ useSimilarItems: () => ({ data: undefined, isPending: false }) }));
jest.mock('@/features/social/hooks', () => ({
  useItemSaved: () => ({ data: false }),
  useSaveItem: () => ({ mutate: jest.fn() }),
}));

type Summary = Record<string, unknown>;
let mockSummary: Summary;
const mockRefresh = jest.fn();
jest.mock('@/features/earnings/hooks', () => ({
  useEarnings: () => ({ data: mockSummary, isPending: false, isError: false }),
  useSales: () => ({
    data: [
      {
        id: 's1',
        occurredAt: new Date().toISOString(),
        status: 'pending',
        earnedCents: 700,
        saleCents: 10000,
        postId: 'p1',
        itemTitle: 'Oak desk',
        thumb: null,
      },
      {
        id: 's2',
        occurredAt: new Date().toISOString(),
        status: 'reversed',
        earnedCents: 300,
        saleCents: 4000,
        postId: 'p1',
        itemTitle: 'Lamp',
        thumb: null,
      },
    ],
    isPending: false,
  }),
  usePayouts: () => ({ data: [{ id: 'po1', amountCents: 3500, status: 'paid', createdAt: new Date().toISOString() }] }),
  useRefreshPayoutAccount: () => ({ mutate: mockRefresh, isPending: false }),
}));

const base = {
  pendingCents: 700,
  availableCents: 2800,
  paidCents: 3500,
  sharePercent: 70,
  minimumPayoutCents: 2500,
  nextPayoutOn: '2026-12-01',
  hasAccount: false,
  detailsSubmitted: false,
  payoutsEnabled: false,
  country: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSummary = { ...base };
});

describe('Earnings', () => {
  it('shows balances, sales, payouts and the rules', async () => {
    await render(<Earnings />);
    expect(screen.getByLabelText('$28.00 ready for your next payout')).toBeTruthy();
    expect(screen.getByLabelText('$7.00 pending')).toBeTruthy();
    expect(screen.getByLabelText('Oak desk: you earned $7.00, Waiting for return window')).toBeTruthy();
    expect(screen.getByLabelText('Lamp: you earned $3.00, Returned')).toBeTruthy();
    expect(screen.getByText(/you get 70% of the store’s commission/)).toBeTruthy();
    expect(screen.getAllByText('$35.00')).toHaveLength(2); // paid so far, and the payout row
  });

  it('sets up payouts with Stripe for the chosen country', async () => {
    mockInvoke.mockResolvedValue({ data: { url: 'https://connect.stripe.com/x' }, error: null });
    await render(<Earnings />);
    await fireEvent.press(screen.getByRole('button', { name: 'Set up payouts' }));
    await fireEvent.changeText(screen.getByLabelText('Search countries'), 'egy');
    await fireEvent.press(screen.getByRole('button', { name: 'Egypt' }));
    await waitFor(() =>
      expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith('https://connect.stripe.com/x', 'locale://earnings'),
    );
    expect(mockInvoke).toHaveBeenCalledWith('stripe-connect', { body: { action: 'onboard', country: 'EG' } });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('explains when Stripe can’t pay a country', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { FunctionsHttpError } = jest.requireActual('@supabase/supabase-js');
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError({
        status: 400,
        json: async () => ({ error: 'stripe_rejected', detail: 'Country not supported' }),
      }),
    });
    await render(<Earnings />);
    await fireEvent.press(screen.getByRole('button', { name: 'Set up payouts' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Canada' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Payout setup didn’t finish', 'Country not supported'));
  });

  it('tells a ready creator when the next payout is', async () => {
    mockSummary = { ...base, hasAccount: true, detailsSubmitted: true, payoutsEnabled: true, country: 'US' };
    await render(<Earnings />);
    expect(screen.getByText('Payouts are on')).toBeTruthy();
    expect(screen.getByText(/Your next payout is on December 1/)).toBeTruthy();
    expect(mockRefresh).toHaveBeenCalled();
  });
});

describe('Shopping a tagged item', () => {
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
  it('opens the tracked link and discloses commission', async () => {
    mockInvoke.mockResolvedValue({ data: { url: 'https://net.example/?u=x&sub=c1' }, error: null });
    await render(<ItemSheet item={item} postId="p1" onClose={jest.fn()} />);
    expect(screen.getByText(/the poster and Locale may earn a commission/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Shop on shop.com' }));
    await waitFor(() =>
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://net.example/?u=x&sub=c1', expect.anything()),
    );
    expect(mockInvoke).toHaveBeenCalledWith('shop-link', { body: { postId: 'p1', itemId: 'i1' } });
  });

  it('still opens the store if tracking fails', async () => {
    mockInvoke.mockRejectedValue(new Error('offline'));
    await render(<ItemSheet item={item} postId="p1" onClose={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Shop on shop.com' }));
    await waitFor(() =>
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://shop.com/d', expect.anything()),
    );
  });
});
