import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import type { FeedPost, Item } from '@/features/posts/api';
import { StoryCard } from '@/features/share/StoryCard';
import { StoryShareSheet } from '@/features/share/StoryShareSheet';

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const item = (id: string, title: string, brand: string | null, cents: number | null): Item => ({
  id, title, brand, storeName: null, url: null, urlHost: null, priceCents: cents, currency: cents ? 'USD' : null, isAffiliate: false,
});

const post = (tags: { x: number; y: number; item: Item }[], over: Partial<FeedPost> = {}): FeedPost => ({
  id: 'p1', caption: 'Weekend setup', publishedAt: '2026-11-05T10:00:00Z', rankAt: '2026-11-05T10:00:00Z', likeCount: 0, commentCount: 0, iLiked: false, iSaved: false,
  author: { id: 'u1', handle: 'sami', displayName: 'Sami' }, areaName: null, interestIds: [2], matchedItemIds: [],
  media: [{ kind: 'image', videoUrl: null, duration: null, path: 'p1/0.jpg', width: 1000, height: 1000, url: 'https://s/0', tags: tags.map((t, i) => ({ id: `t${i}`, ...t })) }],
  ...over,
});

const keyboard = item('i1', 'Mechanical keyboard', 'Keychron', 9900);
const lamp = item('i2', 'Desk lamp', 'BenQ', 17900);
const mug = item('i3', 'Mug', null, null);
const mat = item('i4', 'Desk mat', 'Grovemade', 8000);

describe('StoryCard', () => {
  it('lists up to three pieces with prices, and says how many more are on Locale', async () => {
    await render(<StoryCard post={post([{ x: 0.5, y: 0.5, item: keyboard }, { x: 0.2, y: 0.2, item: lamp }, { x: 0.3, y: 0.8, item: mug }, { x: 0.7, y: 0.9, item: mat }])} width={360} title="Shop this" />);
    expect(screen.getByText('Shop this')).toBeTruthy();
    expect(screen.getByText(/Mechanical keyboard/)).toBeTruthy();
    expect(screen.getByText(/\$99/)).toBeTruthy();
    expect(screen.queryByText(/Desk mat/)).toBeNull();
    expect(screen.getByText('+1 more on Locale')).toBeTruthy();
    expect(screen.getByText('@sami')).toBeTruthy();
    expect(screen.getByText('Find every piece on Locale')).toBeTruthy();
  });

  it('places dots on the cropped photo and drops ones cropped out', async () => {
    // A square photo in a 360x409 frame is scaled to 409x409 and cropped ~24.5px each side.
    await render(<StoryCard post={post([{ x: 0.5, y: 0.5, item: keyboard }, { x: 0.01, y: 0.5, item: lamp }])} width={360} title="Shop this" />);
    expect(screen.getAllByText('1').length).toBeGreaterThan(1); // dot and list number
    expect(screen.getAllByText('2')).toHaveLength(1); // only the list number: its dot is outside the crop
  });

  it('shows the caption when nothing is tagged', async () => {
    await render(<StoryCard post={post([])} width={360} title="Shop this" />);
    expect(screen.getByText('Weekend setup')).toBeTruthy();
    expect(screen.getByText('More on Locale')).toBeTruthy();
  });
});

describe('StoryShareSheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders a 1080x1920 image and opens the share sheet', async () => {
    (captureRef as jest.Mock).mockResolvedValue('file:///story.png');
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    const onClose = jest.fn();
    await render(<StoryShareSheet post={post([{ x: 0.5, y: 0.5, item: keyboard }])} interests={new Map()} onClose={onClose} />);
    const button = screen.getByRole('button', { name: 'Share' });
    expect(button).toBeDisabled(); // waits for the photo to load
    await fireEvent(screen.getByTestId('story-photo'), 'load', { nativeEvent: { source: { width: 1000, height: 1000, url: 'https://s/0' }, cacheType: 'none' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(captureRef).toHaveBeenCalledWith(expect.anything(), { format: 'png', result: 'tmpfile', width: 1080, height: 1920 });
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///story.png', expect.objectContaining({ mimeType: 'image/png' }));
  });

  it('explains when sharing is unavailable', async () => {
    (captureRef as jest.Mock).mockResolvedValue('file:///story.png');
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<StoryShareSheet post={post([])} interests={new Map()} onClose={jest.fn()} />);
    await fireEvent(screen.getByTestId('story-photo'), 'load', { nativeEvent: { source: { width: 1000, height: 1000, url: 'https://s/0' }, cacheType: 'none' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Sharing isn’t available on this device.'));
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});
