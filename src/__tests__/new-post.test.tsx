import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import NewPost from '@/app/(app)/new-post';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';
import { usePublishPost } from '@/features/posts/hooks';

const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ router: { back: () => mockBack() }, useLocalSearchParams: () => mockParams }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-video', () => ({
  createVideoPlayer: () => ({ generateThumbnailsAsync: async () => [{}], release: jest.fn() }),
}));
jest.mock('@/features/onboarding/hooks', () => ({ useInterests: jest.fn(), useMyProfile: jest.fn() }));
jest.mock('@/features/posts/hooks', () => ({ usePublishPost: jest.fn() }));
let mockLocal = false;
jest.mock('@/lib/features', () => ({
  get LOCAL_FEATURES() {
    return mockLocal;
  },
}));

const mutateAsync = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockLocal = false;
  (useMyProfile as jest.Mock).mockReturnValue({ data: { area: { id: 'a', name: 'Downtown' } } });
  (useInterests as jest.Mock).mockReturnValue({
    data: [
      { id: 1, label: 'Dogs', is_family: false },
      { id: 2, label: 'Coffee', is_family: false },
      { id: 3, label: 'Books', is_family: false },
      { id: 4, label: 'Toddlers', is_family: true },
    ],
  });
  (usePublishPost as jest.Mock).mockReturnValue({ mutateAsync, isPending: false });
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///a.jpg', width: 4032, height: 3024 }],
  });
});

describe('New post', () => {
  it('needs a photo, then publishes with caption and tags', async () => {
    mutateAsync.mockResolvedValue('post-id');
    await render(<NewPost />);
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
    expect(screen.getByText(/anyone on Locale can see this post/)).toBeTruthy();
    expect(screen.queryByLabelText('Nearby only')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Add photos' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled());

    await fireEvent.changeText(screen.getByLabelText('Caption'), 'Morning walk');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Dogs' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      photos: [{ uri: 'file:///a.jpg', width: 4032, height: 3024 }],
      caption: 'Morning walk',
      interestIds: [1],
      tags: [],
      searchable: true,
      groupId: null,
      video: null,
    });
  });

  it('posts a single video, tagged from its poster frame', async () => {
    mutateAsync.mockResolvedValue('post-id');
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///clip.mov', width: 1080, height: 1920, duration: 14_200 }],
    });
    await render(<NewPost />);
    await fireEvent.press(screen.getByRole('button', { name: /Add a video/ }));
    await waitFor(() => expect(screen.getByText('Video, 14s')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Add photos|Add more/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tag items in the video' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          photos: [],
          video: { uri: 'file:///clip.mov', width: 1080, height: 1920, durationMs: 14_200 },
        }),
      ),
    );
  });

  it('refuses videos over 60 seconds', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///long.mov', width: 1080, height: 1920, duration: 95_000 }],
    });
    await render(<NewPost />);
    await fireEvent.press(screen.getByRole('button', { name: /Add a video/ }));
    expect(await screen.findByText(/Videos can be up to 60 seconds/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
  });

  it('posts into a group without the public options', async () => {
    mockParams = { groupId: '6f1c0d3e-0000-4000-8000-000000000001', groupName: 'Toddler parents' };
    mutateAsync.mockResolvedValue('post-id');
    await render(<NewPost />);
    expect(screen.getByText('Post in Toddler parents')).toBeTruthy();
    expect(screen.queryByLabelText('Nearby only')).toBeNull();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Toddlers' }));
    expect(screen.queryByText(/avoid showing children’s faces/i)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Add photos' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled());
    await fireEvent.press(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ groupId: '6f1c0d3e-0000-4000-8000-000000000001' })),
    );
  });

  it('allows at most 3 tags', async () => {
    await render(<NewPost />);
    for (const name of ['Dogs', 'Coffee', 'Books', 'Toddlers']) {
      await fireEvent.press(screen.getByRole('checkbox', { name }));
    }
    expect(screen.getByRole('checkbox', { name: 'Toddlers' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Books' })).toBeChecked();
  });

  it('local mode: warns about children\'s faces when a family tag is picked', async () => {
    mockLocal = true;
    await render(<NewPost />);
    expect(screen.queryByText(/avoid showing children’s faces/i)).toBeNull();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Toddlers' }));
    expect(screen.getByText(/avoid showing children’s faces/i)).toBeTruthy();
    expect(screen.getByText(/kid-related tags are only shown within about 15 km/)).toBeTruthy();
    expect(screen.getByLabelText('Nearby only')).toBeDisabled();
  });

  it('local mode: can be kept nearby only', async () => {
    mockLocal = true;
    mutateAsync.mockResolvedValue('post-id');
    await render(<NewPost />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add photos' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled());
    await fireEvent(screen.getByLabelText('Nearby only'), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ searchable: false })));
  });

  it('keeps the draft and explains when publishing fails', async () => {
    mutateAsync.mockRejectedValue(new Error('post_rate_limited'));
    await render(<NewPost />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add photos' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled());
    await fireEvent.press(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText(/today's posting limit/)).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeTruthy();
  });
});
