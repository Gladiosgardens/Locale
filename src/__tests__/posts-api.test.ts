import { FunctionsHttpError } from '@supabase/supabase-js';
import { fetchFeedPage, publishPost, searchPosts } from '@/features/posts/api';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    storage: { from: jest.fn() },
    functions: { invoke: jest.fn() },
  },
}));

const createSignedUrls = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (supabase.storage.from as jest.Mock).mockReturnValue({ createSignedUrls });
});

describe('fetchFeedPage', () => {
  it('passes the cursor and filter, and signs every image in one request', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      error: null,
      data: [
        {
          id: 'p1', caption: 'hi', published_at: '2026-11-03T19:00:00Z', author_id: 'u1',
          author_handle: 'ana', author_display_name: 'Ana', area_name: 'Downtown', interest_ids: [1],
          media: [{ path: 'p1/0.jpg', width: 10, height: 20 }, { path: 'p1/1.jpg', width: 10, height: 20 }],
        },
      ],
    });
    createSignedUrls.mockResolvedValue({
      error: null,
      data: [
        { path: 'p1/0.jpg', signedUrl: 'https://s/0', error: null },
        { path: 'p1/1.jpg', signedUrl: null, error: 'denied' },
      ],
    });

    const page = await fetchFeedPage('nearby', { publishedAt: '2026-11-03T20:00:00Z', id: 'p0' }, 7);

    expect(supabase.rpc).toHaveBeenCalledWith('nearby_feed', {
      p_limit: 20,
      p_before_published_at: '2026-11-03T20:00:00Z',
      p_before_id: 'p0',
      p_interest_id: 7,
    });
    expect(supabase.storage.from).toHaveBeenCalledWith('post-media');
    expect(createSignedUrls).toHaveBeenCalledWith(['p1/0.jpg', 'p1/1.jpg'], 3600);
    expect(page[0].author).toEqual({ id: 'u1', handle: 'ana', displayName: 'Ana' });
    expect(page[0].media.map((m) => m.url)).toEqual(['https://s/0', null]);
  });

  it('skips signing when the page is empty', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ error: null, data: [] });
    await expect(fetchFeedPage('nearby', null, null)).resolves.toEqual([]);
    expect(supabase.rpc).toHaveBeenCalledWith('nearby_feed', { p_limit: 20 });
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});

describe('discovery', () => {
  it('Everywhere and search use discover_posts and map tags and nullable areas', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      error: null,
      data: [{
        id: 'p9', caption: null, published_at: '2026-11-03T19:00:00Z', author_id: 'u9', author_handle: 'fay',
        author_display_name: 'Fay', area_name: null, interest_ids: [], matched_item_ids: ['i1'],
        media: [{ path: 'p9/0.jpg', width: 1, height: 1, tags: [{ id: 't1', x: 0.1, y: 0.2, item: {
          id: 'i1', title: 'Linen dress', brand: 'Reformation', store_name: null, url: null, url_host: null,
          price_cents: null, currency: null, is_affiliate: false } }] }],
      }],
    });
    createSignedUrls.mockResolvedValue({ error: null, data: [{ path: 'p9/0.jpg', signedUrl: 'https://s/9', error: null }] });

    await fetchFeedPage('everywhere', null, 3);
    expect(supabase.rpc).toHaveBeenLastCalledWith('discover_posts', { p_limit: 20 });

    const [found] = await searchPosts('  linen ', null);
    expect(supabase.rpc).toHaveBeenLastCalledWith('discover_posts', { p_query: 'linen', p_limit: 20 });
    expect(found.areaName).toBeNull();
    expect(found.matchedItemIds).toEqual(['i1']);
    expect(found.media[0].tags[0].item).toMatchObject({ title: 'Linen dress', brand: 'Reformation', storeName: null });
  });
});

describe('publishPost', () => {
  it('surfaces the error code from the Edge Function', async () => {
    const response = { json: async () => ({ error: 'post_rate_limited' }) };
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(response),
    });
    await expect(publishPost({ uploads: ['u/x.jpg'], caption: ' ', interestIds: [] })).rejects.toThrow(
      'post_rate_limited',
    );
    expect(supabase.functions.invoke).toHaveBeenCalledWith('publish-post', {
      body: { uploads: ['u/x.jpg'], caption: null, interestIds: [], tags: [], searchable: true, groupId: null },
    });
  });
});
