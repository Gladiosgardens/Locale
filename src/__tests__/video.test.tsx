import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import * as api from '@/features/posts/api';
import { fetchFeedPage, type FeedPost } from '@/features/posts/api';
import { usePublishPost } from '@/features/posts/hooks';
import { PostCard } from '@/features/posts/PostCard';
import { supabase } from '@/lib/supabase';

const mockPlayer = { play: jest.fn(), pause: jest.fn(), muted: true, loop: true, playing: false };
jest.mock('expo-video', () => ({
  useVideoPlayer: (_src: string, setup?: (p: unknown) => void) => {
    setup?.(mockPlayer);
    return mockPlayer;
  },
  VideoView: () => null,
}));
jest.mock('expo', () => ({ ...jest.requireActual('expo'), useEvent: () => ({ isPlaying: false }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), storage: { from: jest.fn() }, functions: { invoke: jest.fn() } },
}));

const videoPost: FeedPost = {
  id: 'v1', caption: 'Setup tour', publishedAt: new Date().toISOString(), rankAt: new Date().toISOString(),
  author: { id: 'u1', handle: 'sami', displayName: 'Sami' }, areaName: null, interestIds: [], matchedItemIds: [],
  likeCount: 0, commentCount: 0, iLiked: false, iSaved: false,
  media: [{
    kind: 'video', path: 'pb1', width: 1080, height: 1920, duration: 14,
    url: 'https://image.mux.com/pb1/thumbnail.jpg?width=720&time=1', videoUrl: 'https://stream.mux.com/pb1.m3u8',
    tags: [{ id: 't1', x: 0.5, y: 0.5, item: { id: 'i1', title: 'Desk lamp', brand: 'BenQ', storeName: null, url: null, urlHost: null, priceCents: null, currency: null, isAffiliate: false } }],
  }],
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => jest.clearAllMocks());

describe('video in the feed', () => {
  it('plays only while on screen, muted until tapped, with its items below', async () => {
    const view = await render(
      <PostCard post={videoPost} interests={new Map()} onMenu={jest.fn()} onOpenItem={jest.fn()} active={false} />,
      { wrapper },
    );
    expect(mockPlayer.pause).toHaveBeenCalled();
    expect(mockPlayer.play).not.toHaveBeenCalled();
    expect(screen.getByText('Shop this')).toBeTruthy();
    expect(screen.getByText('1 item')).toBeTruthy();
    await view.rerender(<PostCard post={videoPost} interests={new Map()} onMenu={jest.fn()} onOpenItem={jest.fn()} active />);
    expect(mockPlayer.play).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Turn sound on' }));
    expect(mockPlayer.muted).toBe(false);
    expect(screen.getByRole('button', { name: 'Turn sound off' })).toBeTruthy();
  });
});

describe('video feed data', () => {
  it('maps Mux playback ids to stream and poster addresses, and signs only photos', async () => {
    const createSignedUrls = jest.fn().mockResolvedValue({ error: null, data: [] });
    (supabase.storage.from as jest.Mock).mockReturnValue({ createSignedUrls });
    (supabase.rpc as jest.Mock).mockResolvedValue({
      error: null,
      data: [{
        id: 'v1', caption: null, published_at: '2026-11-05T10:00:00Z', author_id: 'u1', author_handle: 'sami',
        author_display_name: 'Sami', area_name: null, interest_ids: [],
        media: [{ kind: 'video', path: null, playback_id: 'pb1', duration: 14, width: 1080, height: 1920, tags: [] }],
      }],
    });
    const [post] = await fetchFeedPage('for-you', null, null);
    expect(post.media[0]).toEqual(expect.objectContaining({
      kind: 'video', videoUrl: 'https://stream.mux.com/pb1.m3u8', url: 'https://image.mux.com/pb1/thumbnail.jpg?width=720&time=1',
    }));
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});

describe('publishing a video', () => {
  it('uploads to Mux, waits until it is ready, then publishes', async () => {
    jest.useFakeTimers();
    jest.spyOn(api, 'createVideoUpload').mockResolvedValue({ uploadId: 'up123456', url: 'https://storage.mux.com/x' });
    const upload = jest.spyOn(api, 'uploadVideoFile').mockResolvedValue();
    const status = jest.spyOn(api, 'videoStatus')
      .mockResolvedValueOnce({ status: 'processing' })
      .mockResolvedValueOnce({ status: 'ready' });
    const publish = jest.spyOn(api, 'publishPost').mockResolvedValue('post-1');
    const stages: string[] = [];
    const { result } = await renderHook(() => usePublishPost((s) => stages.push(s)), { wrapper });
    let done: Promise<string> | undefined;
    await act(async () => {
      done = result.current.mutateAsync({
        photos: [], video: { uri: 'file:///clip.mov', width: 1080, height: 1920, durationMs: 14000 }, caption: 'hi', interestIds: [],
      });
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2500);
    });
    await expect(done).resolves.toBe('post-1');
    expect(upload).toHaveBeenCalledWith('https://storage.mux.com/x', 'file:///clip.mov');
    expect(status).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ uploads: [], videoUploadId: 'up123456' }));
    expect(stages).toEqual(['uploading', 'processing', 'publishing']);
    jest.useRealTimers();
  });

  it('explains a video Mux says is too long', async () => {
    jest.spyOn(api, 'createVideoUpload').mockResolvedValue({ uploadId: 'up123456', url: 'https://u' });
    jest.spyOn(api, 'uploadVideoFile').mockResolvedValue();
    jest.spyOn(api, 'videoStatus').mockResolvedValue({ status: 'failed', reason: 'too_long' });
    const publish = jest.spyOn(api, 'publishPost');
    const { result } = await renderHook(() => usePublishPost(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ photos: [], video: { uri: 'f', width: 1, height: 1, durationMs: 1 }, caption: '', interestIds: [] }),
      ).rejects.toThrow('video_too_long');
    });
    expect(publish).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
