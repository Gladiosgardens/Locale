import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { ItemSheet } from '@/features/items/ItemSheet';
import { TagEditor, toFramePoint } from '@/features/items/TagEditor';
import type { FeedPost, Item } from '@/features/posts/api';
import { PostCard } from '@/features/posts/PostCard';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
let mockSimilar: { data?: unknown[]; isPending: boolean; isError?: boolean } = { data: undefined, isPending: false };
const mockSimilarCalls: unknown[][] = [];
jest.mock('@/features/posts/hooks', () => ({
  useLikePost: () => ({ mutate: jest.fn() }),
  useSavePost: () => ({ mutate: jest.fn() }),
  useSimilarItems: (...a: unknown[]) => {
    mockSimilarCalls.push(a);
    return mockSimilar;
  },
  useFilteredFeed: () => ({ data: { pages: [[]] }, isPending: false, isError: false, isRefetching: false, isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn() }),
  useRemoveMyTag: () => ({ mutate: jest.fn() }),
}));
const mockSaveItem = jest.fn();
let mockSaved = false;
jest.mock('@/features/social/hooks', () => ({
  useItemSaved: (id?: string) => ({ data: id ? mockSaved : undefined }),
  useSaveItem: () => ({ mutate: mockSaveItem }),
}));

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
  likeCount: 0, commentCount: 0, iLiked: false, iSaved: false,
  author: { id: 'u1', handle: 'amy', displayName: 'Amy' },
  areaName: null,
  interestIds: [],
  matchedItemIds: [],
  media: [{ people: [],
    kind: 'image', videoUrl: null, duration: null, path: 'p1/0.jpg', width: 1000, height: 800, url: 'https://s/0',
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
    expect(onOpenItem).toHaveBeenCalledWith(sofa, 'p1');
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
    expect(onOpenItem).toHaveBeenCalledWith(lamp, 'p1');
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

describe('saving items', () => {
  it('offers Save to wishlist when the post is known, and saves it', async () => {
    mockSaved = false;
    await render(<ItemSheet item={sofa} postId="p1" onClose={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save to wishlist' }));
    expect(mockSaveItem).toHaveBeenCalledWith({ itemId: 'i1', postId: 'p1', saved: true }, expect.anything());
  });

  it('shows when an item is already saved, and can remove it', async () => {
    mockSaved = true;
    await render(<ItemSheet item={sofa} postId="p1" onClose={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Saved to your wishlist' }));
    expect(mockSaveItem).toHaveBeenLastCalledWith({ itemId: 'i1', postId: 'p1', saved: false }, expect.anything());
  });

  it('has no Save button without a post to save from', async () => {
    await render(<ItemSheet item={sofa} onClose={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /wishlist/ })).toBeNull();
  });
});

describe('find similar', () => {
  it('looks up similar items only when asked, and opens a result', async () => {
    mockSimilarCalls.length = 0;
    mockSimilar = {
      isPending: false,
      data: [{ title: 'Velvet sofa', store: 'West Elm', url: 'https://www.westelm.com/sofa', host: 'westelm.com', priceCents: 129900, currency: 'USD', thumbnail: null }],
    };
    const open = jest.spyOn(WebBrowser, 'openBrowserAsync').mockResolvedValue({ type: 'opened' } as never);
    await render(<ItemSheet item={sofa} postId="p1" onClose={jest.fn()} />);
    expect(mockSimilarCalls.at(-1)).toEqual(['i1', 'p1', false]);
    expect(screen.queryByText('Velvet sofa')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Find similar online' }));
    expect(mockSimilarCalls.at(-1)).toEqual(['i1', 'p1', true]);
    expect(screen.getByText(/may not be the exact item/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: /Velvet sofa, West Elm/ }));
    expect(open).toHaveBeenCalledWith('https://www.westelm.com/sofa', expect.anything());
  });
});

describe('automatic detection while tagging', () => {
  const photo = { uri: 'file:///room.jpg', width: 1000, height: 1000 };
  const found = [
    {
      name: 'Brass floor lamp', category: 'lighting', x: 0.7, y: 0.4, query: 'brass arc floor lamp',
      matches: [{ title: 'Arc Floor Lamp', store: 'CB2', url: 'https://www.cb2.com/lamp', host: 'cb2.com', priceCents: 39900, currency: 'USD', thumbnail: null }],
    },
    { name: 'Wool rug', category: 'decor', x: 0.5, y: 0.9, query: 'cream wool rug', matches: [] },
  ];

  it('suggests items and turns a chosen match into a tag', async () => {
    const onChange = jest.fn();
    const onDetect = jest.fn().mockResolvedValue(found);
    await render(
      <TagEditor photo={photo} mediaIndex={0} tags={[]} remainingForPost={20} onChange={onChange} onClose={jest.fn()} onDetect={onDetect} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Find items automatically' }));
    expect(await screen.findByText('We found 2 items')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Brass floor lamp, 1 matches' }));
    await fireEvent.press(screen.getByRole('button', { name: /Arc Floor Lamp, CB2/ }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        media: 0,
        item: { title: 'Brass floor lamp', store_name: 'CB2', url: 'https://www.cb2.com/lamp', price_cents: 39900, currency: 'USD' },
      }),
    ]);
    expect(screen.queryByRole('button', { name: /Brass floor lamp/ })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Wool rug, 0 matches' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tag it without a link' }));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ item: { title: 'Wool rug' } })]);
  });

  it('explains when detection fails, and has no button without detection', async () => {
    const onDetect = jest.fn().mockRejectedValue(new Error('detection_rate_limited'));
    const view = await render(
      <TagEditor photo={photo} mediaIndex={0} tags={[]} remainingForPost={20} onChange={jest.fn()} onClose={jest.fn()} onDetect={onDetect} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Find items automatically' }));
    await waitFor(() => expect(screen.getByText(/used automatic item finding a lot today/)).toBeTruthy());
    await view.rerender(<TagEditor photo={photo} mediaIndex={0} tags={[]} remainingForPost={20} onChange={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Find items automatically' })).toBeNull();
  });

  it('maps positions on a tall photo onto its cropped frame', () => {
    // A 1000x2000 photo in a 400x500 frame is scaled to 400x800 and cropped 150 px top and bottom.
    expect(toFramePoint({ x: 0.5, y: 0.5 }, { width: 1000, height: 2000 }, 400, 500)).toEqual({ x: 0.5, y: 0.5 });
    expect(toFramePoint({ x: 0.5, y: 0.25 }, { width: 1000, height: 2000 }, 400, 500).y).toBeCloseTo(0.1);
    expect(toFramePoint({ x: 0.5, y: 0.05 }, { width: 1000, height: 2000 }, 400, 500).y).toBe(0.02);
  });
});
