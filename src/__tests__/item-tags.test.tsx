import { fireEvent, render, screen } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { ItemSheet } from '@/features/items/ItemSheet';
import type { FeedPost, Item } from '@/features/posts/api';
import { PostCard } from '@/features/posts/PostCard';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const sofa: Item = {
  id: 'i1', title: 'Linen sofa', brand: 'IKEA', storeName: 'IKEA', url: 'https://www.ikea.com/sofa',
  urlHost: 'www.ikea.com', priceCents: 89900, currency: 'USD', isAffiliate: true,
};
const lamp: Item = {
  id: 'i2', title: 'Brass lamp', brand: null, storeName: 'Flea market', url: null,
  urlHost: null, priceCents: null, currency: null, isAffiliate: false,
};

const post = (over: Partial<FeedPost> = {}): FeedPost => ({
  id: 'p1',
  caption: 'Living room',
  publishedAt: new Date().toISOString(),
  rankAt: new Date().toISOString(),
  author: { id: 'u1', handle: 'amy', displayName: 'Amy' },
  areaName: null,
  interestIds: [],
  matchedItemIds: [],
  media: [{
    path: 'p1/0.jpg', width: 1000, height: 800, url: 'https://s/0',
    tags: [{ id: 't1', x: 0.3, y: 0.6, item: sofa }, { id: 't2', x: 0.8, y: 0.2, item: lamp }],
  }],
  ...over,
});

describe('tags on a post', () => {
  it('shows an item count, reveals dots on tap and opens an item', async () => {
    const onOpenItem = jest.fn();
    await render(<PostCard post={post()} interests={new Map()} onMenu={jest.fn()} onOpenItem={onOpenItem} />);
    expect(screen.getByText('2 items')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Item: Linen sofa' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Show 2 tagged items' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Item: Linen sofa' }));
    expect(onOpenItem).toHaveBeenCalledWith(sofa);
  });

  it('omits the area for far-away posts', async () => {
    await render(<PostCard post={post()} interests={new Map()} onMenu={jest.fn()} onOpenItem={jest.fn()} />);
    expect(screen.getByText('@amy')).toBeTruthy();
    expect(screen.queryByText(/Downtown/)).toBeNull();
  });

  it('numbers the items in a Shop the look strip', async () => {
    const onOpenItem = jest.fn();
    await render(<PostCard post={post()} interests={new Map()} onMenu={jest.fn()} onOpenItem={onOpenItem} />);
    // A living-room post isn't an outfit, so the strip is "Shop this".
    expect(screen.getByText('Shop this')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Brass lamp, Flea market' }));
    expect(onOpenItem).toHaveBeenCalledWith(lamp);
  });

  it('opens search results with their tags already showing', async () => {
    await render(
      <PostCard post={post({ matchedItemIds: ['i1'] })} interests={new Map()} onMenu={jest.fn()} onOpenItem={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Item: Linen sofa' })).toBeTruthy();
  });
});

describe('item sheet', () => {
  it('shows details, the affiliate label and a link that names the real site', async () => {
    await render(<ItemSheet item={sofa} onClose={jest.fn()} />);
    expect(screen.getByText('IKEA')).toBeTruthy();
    expect(screen.getByText(/899/)).toBeTruthy();
    expect(screen.getByText(/Affiliate link/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Shop on www.ikea.com' }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://www.ikea.com/sofa', { dismissButtonStyle: 'close' });
  });

  it('shows only the store when there is no link to buy', async () => {
    await render(<ItemSheet item={lamp} onClose={jest.fn()} />);
    expect(screen.getByText('Available at Flea market. No link was added.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Shop on/ })).toBeNull();
  });
});
