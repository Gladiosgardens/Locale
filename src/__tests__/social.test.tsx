import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import Comments from '@/app/(app)/comments/[postId]';
import Saved from '@/app/(app)/saved';
import type { FeedPost } from '@/features/posts/api';
import * as postHooks from '@/features/posts/hooks';
import { PostCard } from '@/features/posts/PostCard';
import * as socialHooks from '@/features/social/hooks';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useLocalSearchParams: () => ({ postId: 'p1' }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/features/safety/hooks', () => ({ useReport: () => ({ mutateAsync: jest.fn(), isPending: false }) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const post = (over: Partial<FeedPost> = {}): FeedPost => ({
  id: 'p1', caption: 'New desk', publishedAt: new Date().toISOString(), rankAt: new Date().toISOString(),
  author: { id: 'u1', handle: 'sami', displayName: 'Sami' }, areaName: null, interestIds: [], matchedItemIds: [],
  media: [{ kind: 'image', videoUrl: null, duration: null, path: 'p1/0.jpg', width: 100, height: 100, url: 'https://s/0', tags: [], people: [] }],
  likeCount: 2, commentCount: 3, iLiked: false, iSaved: false, ...over,
});

const like = { mutate: jest.fn() };
const savePost = { mutate: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(postHooks, 'useLikePost').mockReturnValue(like as never);
  jest.spyOn(postHooks, 'useSavePost').mockReturnValue(savePost as never);
});

describe('post actions', () => {
  it('likes at once, updates the count, and undoes it if the server refuses', async () => {
    await render(<PostCard post={post()} interests={new Map()} onMenu={jest.fn()} onOpenItem={jest.fn()} />);
    expect(screen.getByText('2 likes')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Like' }));
    expect(screen.getByText('3 likes')).toBeTruthy();
    expect(like.mutate).toHaveBeenCalledWith({ id: 'p1', like: true }, expect.anything());
    await act(async () => like.mutate.mock.calls[0][1].onError(new Error('x')));
    expect(screen.getByText('2 likes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Like' })).toBeTruthy();
  });

  it('saves the post and opens the comments', async () => {
    await render(<PostCard post={post({ iLiked: true })} interests={new Map()} onMenu={jest.fn()} onOpenItem={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Unlike' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(savePost.mutate).toHaveBeenCalledWith({ id: 'p1', saved: true }, expect.anything());
    expect(screen.getByRole('button', { name: 'Remove from Saved' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'View all 3 comments' }));
    expect(mockPush).toHaveBeenCalledWith('/comments/p1');
  });

  it('hides the count and comment link when there are none', async () => {
    await render(<PostCard post={post({ likeCount: 0, commentCount: 0 })} interests={new Map()} onMenu={jest.fn()} onOpenItem={jest.fn()} />);
    expect(screen.queryByText(/likes?$/)).toBeNull();
    expect(screen.queryByText(/comment/)).toBeNull();
  });
});

describe('Comments', () => {
  const add = { mutate: jest.fn(), isPending: false };
  const remove = { mutate: jest.fn() };
  const likeComment = { mutate: jest.fn() };
  const comment = (id: string, canDelete: boolean, over: object = {}) => ({
    id, body: `Body ${id}`, createdAt: new Date().toISOString(), canDelete, parentId: null, likeCount: 0, iLiked: false,
    author: { id: `a-${id}`, handle: `h${id}`, displayName: `Name ${id}` }, ...over,
  });
  beforeEach(() => {
    jest.spyOn(socialHooks, 'useComments').mockReturnValue({
      data: { pages: [[comment('c1', false), comment('c2', true), comment('r1', false, { parentId: 'c1', likeCount: 2, iLiked: true })]] },
      isPending: false, isError: false, hasNextPage: false,
    } as never);
    jest.spyOn(socialHooks, 'useLikeComment').mockReturnValue(likeComment as never);
    jest.spyOn(socialHooks, 'useAddComment').mockReturnValue(add as never);
    jest.spyOn(socialHooks, 'useDeleteComment').mockReturnValue(remove as never);
  });

  it('lists comments and posts a new one', async () => {
    await render(<Comments />);
    expect(screen.getByText(/Body c1/)).toBeTruthy();
    const postButton = screen.getByRole('button', { name: 'Post comment' });
    expect(postButton).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Where is the lamp from?');
    await fireEvent.press(screen.getByRole('button', { name: 'Post comment' }));
    expect(add.mutate).toHaveBeenCalledWith({ body: 'Where is the lamp from?', parentId: null }, expect.anything());
  });

  it('threads replies under their comment and replies to the thread', async () => {
    await render(<Comments />);
    const bodies = screen.getAllByText(/^Body (c1|c2|r1)$/).map((t) => [t.props.children].flat().join(''));
    expect(bodies).toEqual(['Body c1', 'Body r1', 'Body c2']);
    expect(screen.getByText('2 likes')).toBeTruthy();
    // Replying to a reply answers the top comment's thread.
    await fireEvent.press(screen.getByRole('button', { name: 'Reply to hr1' }));
    expect(screen.getByText('Replying to @hr1')).toBeTruthy();
    expect(screen.getByLabelText('Write a reply to hr1').props.value).toBe('@hr1 ');
    await fireEvent.changeText(screen.getByLabelText('Write a reply to hr1'), '@hr1 thanks!');
    await fireEvent.press(screen.getByRole('button', { name: 'Post comment' }));
    expect(add.mutate).toHaveBeenCalledWith({ body: '@hr1 thanks!', parentId: 'c1' }, expect.anything());
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel reply' }));
    expect(screen.queryByText(/Replying to/)).toBeNull();
  });

  it('likes and unlikes comments', async () => {
    await render(<Comments />);
    const hearts = screen.getAllByRole('button', { name: /like comment/i });
    await fireEvent.press(hearts[0]);
    expect(likeComment.mutate).toHaveBeenCalledWith({ id: 'c1', like: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Unlike comment' }));
    expect(likeComment.mutate).toHaveBeenCalledWith({ id: 'r1', like: false });
  });

  it('deletes your own comments and reports others', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<Comments />);
    const menus = screen.getAllByRole('button', { name: 'Comment options' });
    await fireEvent.press(menus[2]);
    expect(alert.mock.calls[0][0]).toBe('Delete this comment?');
    (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((b) => b.text === 'Delete')!.onPress!();
    expect(remove.mutate).toHaveBeenCalledWith('c2', expect.anything());
    await fireEvent.press(menus[0]);
    await waitFor(() => expect(screen.getByText(/Why are you reporting/i)).toBeTruthy());
  });
});

const filtered = { data: { pages: [[]] }, isPending: false } as never;
function mockCollectionHooks(collections: unknown[] = []) {
  jest.spyOn(socialHooks, 'useCollections').mockReturnValue({ data: collections } as never);
  jest.spyOn(socialHooks, 'useCreateCollection').mockReturnValue({ mutate: jest.fn(), isPending: false } as never);
  jest.spyOn(socialHooks, 'useRenameCollection').mockReturnValue({ mutate: jest.fn(), isPending: false } as never);
  jest.spyOn(socialHooks, 'useDeleteCollection').mockReturnValue({ mutate: jest.fn() } as never);
  jest.spyOn(postHooks, 'useFilteredFeed').mockReturnValue(filtered);
}

describe('Saved', () => {
  it('shows the wishlist with prices and can remove an item', async () => {
    const saveItem = { mutate: jest.fn() };
    jest.spyOn(socialHooks, 'useSaveItem').mockReturnValue(saveItem as never);
    jest.spyOn(socialHooks, 'useItemSaved').mockReturnValue({ data: true } as never);
    jest.spyOn(socialHooks, 'useSavedItems').mockReturnValue({
      data: { pages: [[{
        item: { id: 'i1', title: 'Desk lamp', brand: 'BenQ', storeName: null, url: null, urlHost: null, priceCents: 17900, currency: 'USD', isAffiliate: false },
        postId: 'p1', photoUrl: 'https://s/0', photoPath: 'p1/0.jpg', savedAt: new Date().toISOString(),
      }]] }, isPending: false, isError: false, hasNextPage: false,
    } as never);
    jest.spyOn(postHooks, 'useFeed').mockReturnValue({ data: { pages: [[]] }, isPending: false } as never);
    jest.spyOn(postHooks, 'useSimilarItems').mockReturnValue({ data: undefined, isPending: false } as never);
    mockCollectionHooks();
    await render(<Saved />);
    expect(screen.getByText('Desk lamp')).toBeTruthy();
    expect(screen.getByText(/179/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'See the post Desk lamp is from' }));
    expect(mockPush).toHaveBeenCalledWith('/post/p1');
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Desk lamp from your wishlist' }));
    expect(saveItem.mutate).toHaveBeenCalledWith({ itemId: 'i1', postId: 'p1', saved: false }, expect.anything());
    await fireEvent.press(screen.getByRole('tab', { name: 'Posts' }));
    expect(postHooks.useFeed).toHaveBeenCalledWith('saved', null);
  });
});
