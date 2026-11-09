import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import NewStory from '@/app/(app)/new-story';
import StoryViewer from '@/app/(app)/stories/view';
import type { Story } from '@/features/stories/api';
import { HighlightsRow } from '@/features/stories/HighlightsRow';
import { StoryTray } from '@/features/stories/StoryTray';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    navigate: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-video', () => ({ createVideoPlayer: jest.fn(), useVideoPlayer: jest.fn(), VideoView: () => null }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/features/profiles/hooks', () => ({ useProfile: () => ({ data: { displayName: 'Moh' } }) }));
const mockPublish = jest.fn();
jest.mock('@/features/posts/hooks', () => ({
  usePublishPost: () => ({ mutateAsync: mockPublish, isPending: false }),
  useDetectItems: () => ({ mutateAsync: jest.fn() }),
  useDeletePost: () => ({ mutate: jest.fn() }),
  useSimilarItems: () => ({ data: undefined, isPending: false }),
}));
jest.mock('@/features/social/hooks', () => ({
  useItemSaved: () => ({ data: false }),
  useSaveItem: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/features/safety/hooks', () => ({ useReport: () => ({ mutateAsync: jest.fn(), isPending: false }) }));
jest.mock('@/features/people/hooks', () => ({ usePeopleSearch: () => ({ data: undefined }) }));

let mockTray: unknown[] = [];
let mockStories: Story[] = [];
const mockSeen = jest.fn();
jest.mock('@/features/stories/hooks', () => ({
  useStoryTray: () => ({ data: mockTray }),
  useStories: () => ({ data: mockStories, isPending: false, isError: false }),
  useMarkSeen: () => ({ mutate: mockSeen }),
  useRemoveFromHighlight: () => ({ mutate: jest.fn() }),
  useStoryViewers: () => ({ data: [], isPending: false }),
  useMyHighlights: () => ({ data: [], isPending: false }),
  useAddToHighlight: () => ({ mutate: jest.fn(), isPending: false }),
  useProfileHighlights: () => ({ data: [{ id: 'h1', name: 'Desk', count: 2, coverUrl: null }] }),
  useDeleteHighlight: () => ({ mutate: jest.fn() }),
}));

const person = (id: string) => ({ id, handle: `h_${id}`, displayName: `Name ${id}` });
const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  caption: null,
  publishedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  author: person('ana'),
  seen: false,
  viewCount: null,
  media: {
    kind: 'image',
    path: `${id}/0.jpg`,
    width: 100,
    height: 200,
    url: `https://s/${id}`,
    videoUrl: null,
    duration: null,
    tags: [],
    people: [],
  },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockTray = [];
  mockStories = [];
});

describe('Story tray', () => {
  it('offers to add your story, and opens other people’s in order', async () => {
    mockTray = [
      { author: person('ana'), count: 2, allSeen: false, isMe: false },
      { author: person('ben'), count: 1, allSeen: true, isMe: false },
    ];
    await render(<StoryTray />);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Add to your story' })[0]);
    expect(mockPush).toHaveBeenCalledWith('/new-story');
    expect(screen.getByRole('button', { name: 'Name ana’s story, new' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Name ben’s story' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/stories/view', params: { author: 'ben', queue: 'ana,ben' } });
  });
});

describe('Story viewer', () => {
  it('starts at the first unseen story, marks it seen and moves on', async () => {
    mockParams = { author: 'ana', queue: 'ana,ben' };
    mockStories = [story('s1', { seen: true }), story('s2'), story('s3')];
    await render(<StoryViewer />);
    expect(screen.getByRole('button', { name: /Story 2 of 3/ })).toBeTruthy();
    expect(mockSeen).toHaveBeenCalledWith('s2');
    await fireEvent.press(screen.getByRole('button', { name: /Story 2 of 3/ }), { nativeEvent: { locationX: 300 } });
    expect(screen.getByRole('button', { name: /Story 3 of 3/ })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Story 3 of 3/ }), { nativeEvent: { locationX: 300 } });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/stories/view',
      params: { author: 'ben', queue: 'ana,ben' },
    });
  });

  it('advances photos on a timer', async () => {
    jest.useFakeTimers();
    mockParams = { author: 'ana' };
    mockStories = [story('s1'), story('s2')];
    await render(<StoryViewer />);
    await act(async () => {
      jest.advanceTimersByTime(6200);
    });
    expect(screen.getByRole('button', { name: /Story 2 of 2/ })).toBeTruthy();
    jest.useRealTimers();
  });

  it('lets you shop tagged items', async () => {
    mockParams = { author: 'ana' };
    const item = {
      id: 'i1',
      title: 'Oak desk',
      brand: null,
      storeName: 'Shop',
      url: 'https://shop.com/d',
      urlHost: 'shop.com',
      priceCents: 12000,
      currency: 'USD',
      isAffiliate: false,
    };
    mockStories = [story('s1', { media: { ...story('s1').media, tags: [{ id: 't1', x: 0.5, y: 0.5, item }] } })];
    await render(<StoryViewer />);
    await fireEvent.press(screen.getByRole('button', { name: 'Shop this' }));
    expect(screen.getByText('Oak desk')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Shop on shop.com' })).toBeTruthy();
  });

  it('shows the author their viewers and story options; others can report', async () => {
    mockParams = { author: 'me' };
    mockStories = [story('s1', { author: person('me'), viewCount: 4 })];
    await render(<StoryViewer />);
    expect(mockSeen).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Seen by 4' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Story options' }));
    expect(screen.getByRole('button', { name: 'Add to highlight' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete story' })).toBeTruthy();
  });

  it('says when a story has ended', async () => {
    mockParams = { author: 'ana' };
    await render(<StoryViewer />);
    expect(screen.getByText('This story has ended.')).toBeTruthy();
  });
});

describe('New story', () => {
  it('shares one photo as a story', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///a.jpg', width: 1000, height: 1500 }],
    });
    mockPublish.mockResolvedValue('st1');
    await render(<NewStory />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a photo' }));
    await fireEvent.changeText(await screen.findByLabelText('Text on your story'), 'New desk');
    await fireEvent.press(screen.getByRole('button', { name: 'Share to your story' }));
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/stories/view', params: { author: 'me' } }),
    );
    expect(mockPublish).toHaveBeenCalledWith({
      photos: [{ uri: 'file:///a.jpg', width: 1000, height: 1500 }],
      video: null,
      caption: 'New desk',
      interestIds: [],
      tags: [],
      story: true,
    });
  });

  it('says clearly when sharing fails', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///a.jpg', width: 1000, height: 1500 }],
    });
    mockPublish.mockRejectedValue(new Error('story_rate_limited'));
    await render(<NewStory />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Share to your story' }));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('Your story wasn’t shared', expect.stringMatching(/a lot of stories/)),
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('Highlights', () => {
  it('opens a highlight', async () => {
    await render(<HighlightsRow profileId="ana" isMe={false} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Highlight: Desk, 2 stories' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/stories/view', params: { highlight: 'h1', name: 'Desk' } });
  });
});
