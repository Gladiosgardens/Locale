import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import HashtagScreen from '@/app/(app)/tag/[tag]';
import { RichText } from '@/components/RichText';
import { MentionSuggestions } from '@/features/people/MentionSuggestions';
import { PeopleTagEditor } from '@/features/people/PeopleTagEditor';
import type { FeedPost, PeopleTagDraft } from '@/features/posts/api';
import { PostActions } from '@/features/posts/PostActions';
import { PostCard } from '@/features/posts/PostCard';
import { CollectionSheet } from '@/features/social/CollectionSheet';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useLocalSearchParams: () => ({ tag: 'DeskSetup' }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
const mockFiltered = jest.fn((_f: unknown) => ({
  data: { pages: [[]] }, isPending: false, isError: false, isRefetching: false, isFetchingNextPage: false,
  hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(),
}));
jest.mock('@/features/posts/hooks', () => ({
  useLikePost: () => ({ mutate: jest.fn() }),
  useSavePost: () => ({ mutate: jest.fn() }),
  useDeletePost: () => ({ mutate: jest.fn() }),
  useRemoveMyTag: () => ({ mutate: jest.fn() }),
  useFilteredFeed: (f: unknown) => mockFiltered(f),
  useSimilarItems: () => ({ data: undefined, isPending: false }),
  useUpdateCaption: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/features/onboarding/hooks', () => ({ useInterests: () => ({ data: [] }) }));
jest.mock('@/features/safety/hooks', () => ({
  useBlockUser: () => ({ mutate: jest.fn() }),
  useReport: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
const people = [
  { id: 'u-ben', handle: 'men_ben', displayName: 'Ben', iFollow: false, note: null },
  { id: 'u-bea', handle: 'bea', displayName: 'Bea', iFollow: false, note: null },
];
jest.mock('@/features/people/hooks', () => ({
  usePeopleSearch: (q: string) => ({ data: q.replace(/^@/, '').length >= 2 ? people : undefined, isFetching: false }),
}));
const mockSetIn = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/features/social/hooks', () => ({
  MAX_COLLECTION_NAME: 40,
  useCollections: () => ({ data: [{ id: 'c1', name: 'Desk ideas', postCount: 2, coverUrl: null }], isPending: false }),
  usePostCollections: () => ({ data: ['c1'] }),
  useSetInCollection: () => ({ mutate: mockSetIn }),
  useCreateCollection: () => ({ mutate: mockCreate, isPending: false }),
  useItemSaved: () => ({ data: false }),
  useSaveItem: () => ({ mutate: jest.fn() }),
}));

beforeEach(() => jest.clearAllMocks());

const post = (over: Partial<FeedPost> = {}): FeedPost => ({
  id: 'p1', caption: 'Desk day with @men_ben #DeskSetup', publishedAt: new Date().toISOString(), rankAt: new Date().toISOString(),
  author: { id: 'u-ana', handle: 'ana', displayName: 'Ana' }, areaName: null, interestIds: [], matchedItemIds: [],
  media: [{
    kind: 'image', videoUrl: null, duration: null, path: 'p1/0.jpg', width: 100, height: 100, url: 'https://s/0', tags: [],
    people: [{ profileId: 'u-ben', handle: 'men_ben', x: 0.3, y: 0.4 }],
  }],
  likeCount: 0, commentCount: 0, iLiked: false, iSaved: false, ...over,
});

describe('mentions and hashtags in text', () => {
  it('opens profiles and hashtag pages', async () => {
    await render(<RichText text="hi @Men_Ben, see #DeskSetup" />);
    await fireEvent.press(screen.getByText('@Men_Ben'));
    expect(mockPush).toHaveBeenCalledWith('/u/men_ben');
    await fireEvent.press(screen.getByText('#DeskSetup'));
    expect(mockPush).toHaveBeenCalledWith('/tag/desksetup');
  });

  it('suggests people while typing @ and completes the handle', async () => {
    const onChange = jest.fn();
    const { rerender } = await render(<MentionSuggestions text="hi @b" cursor={5} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: /Mention/ })).toBeNull();
    await rerender(<MentionSuggestions text="hi @be there" cursor={6} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mention @men_ben' }));
    expect(onChange).toHaveBeenCalledWith('hi @men_ben there');
  });

  it('shows posts for a hashtag', async () => {
    await render(<HashtagScreen />);
    expect(screen.getByText('#desksetup')).toBeTruthy();
    expect(mockFiltered).toHaveBeenCalledWith({ hashtag: 'desksetup' });
    expect(screen.getByText(/No posts with #desksetup yet/)).toBeTruthy();
  });
});

describe('people tags on posts', () => {
  it('lists who is tagged and shows their labels on the photo', async () => {
    await render(<PostCard post={post()} interests={new Map()} onMenu={jest.fn()} onOpenItem={jest.fn()} />);
    expect(screen.getByText(/^With/)).toBeTruthy();
    expect(screen.getAllByText('@men_ben')).toHaveLength(2); // in the caption and in "With"
    
    expect(screen.queryByRole('link', { name: 'Tagged: @men_ben' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Show 1 tagged person' }));
    await fireEvent.press(screen.getByRole('link', { name: 'Tagged: @men_ben' }));
    expect(mockPush).toHaveBeenCalledWith('/profile/u-ben');
  });

  it('lets a tagged person remove themselves, and anyone save to a collection', async () => {
    const onPick = jest.fn();
    const { rerender } = await render(<PostActions post={post()} isMine={false} isTagged onPick={onPick} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Remove me from this post' }));
    expect(onPick).toHaveBeenCalledWith('untag', expect.objectContaining({ id: 'p1' }));
    await rerender(<PostActions post={post()} isMine={false} onPick={onPick} onClose={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove me from this post' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save to collection' })).toBeTruthy();
  });
});

describe('tagging people while posting', () => {
  function Harness({ onChange }: { onChange: (t: PeopleTagDraft[]) => void }) {
    const [tags, setTags] = useState<PeopleTagDraft[]>([]);
    return (
      <PeopleTagEditor
        photo={{ uri: 'file://a.jpg', width: 100, height: 100 }}
        position={1}
        tags={tags}
        remaining={20}
        onChange={(t) => {
          setTags(t);
          onChange(t);
        }}
        onClose={jest.fn()}
      />
    );
  }

  it('taps the photo, finds a person and places the tag, then removes it', async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);
    await fireEvent.press(screen.getByLabelText('Photo. Tap where a person is to tag them.'), {
      nativeEvent: { locationX: 0, locationY: 0 },
    });
    await fireEvent.changeText(screen.getByLabelText('Search for a person'), 'be');
    await fireEvent.press(screen.getByRole('button', { name: 'Tag @men_ben' }));
    expect(onChange).toHaveBeenLastCalledWith([{ position: 1, profileId: 'u-ben', handle: 'men_ben', x: 0, y: 0 }]);
    await fireEvent.press(screen.getByRole('button', { name: 'Remove @men_ben' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('collections', () => {
  it('shows which collections hold the post and toggles them', async () => {
    await render(<CollectionSheet postId="p1" onClose={jest.fn()} />);
    const box = screen.getByRole('checkbox', { name: 'Desk ideas' });
    expect(box.props.accessibilityState.checked).toBe(true);
    await fireEvent.press(box);
    expect(mockSetIn).toHaveBeenCalledWith({ collectionId: 'c1', postId: 'p1', inIt: false }, expect.anything());
    expect(screen.getByRole('checkbox', { name: 'Desk ideas' }).props.accessibilityState.checked).toBe(false);
  });

  it('makes a new collection and puts the post in it', async () => {
    await render(<CollectionSheet postId="p1" onClose={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'New collection' }));
    await fireEvent.changeText(screen.getByLabelText('Collection name'), 'Lamps');
    await fireEvent.press(screen.getByRole('button', { name: 'Save collection' }));
    expect(mockCreate).toHaveBeenCalledWith('Lamps', expect.anything());
    mockCreate.mock.calls[0][1].onSuccess('c2');
    expect(mockSetIn).toHaveBeenCalledWith({ collectionId: 'c2', postId: 'p1', inIt: true }, expect.anything());
  });
});
