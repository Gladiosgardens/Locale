import { fireEvent, render, screen } from '@testing-library/react-native';
import ActivityScreen from '@/app/(app)/activity';
import { threadComments, type Comment } from '@/features/social/api';

const mockPush = jest.fn();
const mockMarkSeen = jest.fn();
let mockRows: unknown[] = [];
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/features/people/hooks', () => ({ useFollowPerson: () => ({ mutate: jest.fn() }) }));
jest.mock('@/features/activity/hooks', () => ({
  useActivity: () => ({ data: { pages: [mockRows] }, isPending: false, isError: false, isRefetching: false, hasNextPage: false, refetch: jest.fn() }),
  useMarkActivitySeen: () => ({ mutate: mockMarkSeen }),
}));

const actor = (n: string) => ({ id: `u-${n}`, handle: n, displayName: n.toUpperCase() });
const at = new Date().toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  mockRows = [
    { kind: 'like', actor: actor('ana'), postId: 'p1', postThumb: 'https://t/1', body: null, createdAt: at, iFollowActor: false },
    { kind: 'comment', actor: actor('ben'), postId: 'p1', postThumb: 'https://t/1', body: 'Where is it from?', createdAt: at, iFollowActor: true },
    { kind: 'reply', actor: actor('cy'), postId: 'p2', postThumb: null, body: 'Zara', createdAt: at, iFollowActor: false },
    { kind: 'follow', actor: actor('dee'), postId: null, postThumb: null, body: null, createdAt: at, iFollowActor: false },
  ];
});

describe('Activity', () => {
  it('marks everything seen and lists likes, comments, replies and follows', async () => {
    await render(<ActivityScreen />);
    expect(mockMarkSeen).toHaveBeenCalled();
    expect(screen.getByText(/liked your post/)).toBeTruthy();
    expect(screen.getByText(/Where is it from\?/)).toBeTruthy();
    expect(screen.getByText(/replied to your comment/)).toBeTruthy();
    expect(screen.getByText('DEE')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Follow/ })).toBeTruthy();
  });

  it('opens the post for a like and the comments for a comment', async () => {
    await render(<ActivityScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /^ANA liked/ }));
    expect(mockPush).toHaveBeenCalledWith('/post/p1');
    await fireEvent.press(screen.getByRole('button', { name: /^BEN commented/ }));
    expect(mockPush).toHaveBeenCalledWith('/comments/p1');
  });

  it('explains what shows up here when empty', async () => {
    mockRows = [];
    await render(<ActivityScreen />);
    expect(screen.getByText(/you’ll see it here/)).toBeTruthy();
  });
});

describe('threadComments', () => {
  const c = (id: string, parentId: string | null = null): Comment => ({
    id, parentId, body: id, createdAt: at, canDelete: false, likeCount: 0, iLiked: false, author: actor(id),
  });
  it('puts replies right under their comment, oldest first', () => {
    const out = threadComments([c('a'), c('b'), c('a1', 'a'), c('b1', 'b'), c('a2', 'a')]);
    expect(out.map((x) => `${x.id}${x.isReply ? '*' : ''}`)).toEqual(['a', 'a1*', 'a2*', 'b', 'b1*']);
  });
  it('drops replies whose comment is gone', () => {
    expect(threadComments([c('x1', 'x'), c('b')]).map((x) => x.id)).toEqual(['b']);
  });
});
