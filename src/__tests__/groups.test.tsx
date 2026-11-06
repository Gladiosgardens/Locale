import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import GroupPage from '@/app/(app)/groups/[id]';
import Groups from '@/app/(app)/groups/index';
import NewGroup from '@/app/(app)/groups/new';
import type { Group, RosterEntry } from '@/features/groups/api';
import * as groupHooks from '@/features/groups/hooks';
import { useGroupFeed } from '@/features/posts/hooks';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/features/onboarding/hooks', () => ({
  useMyProfile: () => ({ data: { area: { id: 'a', name: 'Downtown' }, interestIds: [1, 3] } }),
  useInterests: () => ({
    data: [
      { id: 1, label: 'Dogs', is_family: false },
      { id: 3, label: 'Toddlers', is_family: true },
    ],
  }),
}));
jest.mock('@/features/groups/hooks');
jest.mock('@/features/social/hooks', () => ({
  useItemSaved: () => ({ data: false }),
  useSaveItem: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/features/posts/hooks', () => ({
  useLikePost: () => ({ mutate: jest.fn() }),
  useSavePost: () => ({ mutate: jest.fn() }),
  useGroupFeed: jest.fn(),
  useDeletePost: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/features/safety/hooks', () => ({
  useBlockUser: () => ({ mutate: jest.fn() }),
  useReport: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const hooks = groupHooks as jest.Mocked<typeof groupHooks>;
const mutation = (over: Record<string, unknown> = {}) => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false, ...over });

const group = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Toddler parents', description: 'Park meetups', interestId: 3, privacy: 'private',
  areaName: 'Downtown', memberCount: 4, myRole: null, myStatus: null, pendingCount: 0, ...over,
});

const feedResult = { data: { pages: [[]] }, isPending: false, isRefetching: false, isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  for (const name of ['useJoinGroup', 'useLeaveGroup', 'useRespondToRequest', 'useRemoveMember', 'useSetRole', 'useCreateGroup'] as const) {
    (hooks[name] as jest.Mock).mockReturnValue(mutation());
  }
  (hooks.useRoster as jest.Mock).mockReturnValue({ data: undefined });
  (useGroupFeed as jest.Mock).mockReturnValue(feedResult);
});

describe('Groups list', () => {
  it('lists groups with membership badges and filters by interest', async () => {
    (hooks.useGroups as jest.Mock).mockReturnValue({
      isPending: false, isError: false,
      data: [group({ myRole: 'owner', myStatus: 'active', pendingCount: 2 }), group({ id: 'g2', name: 'Dog walkers', interestId: 1, privacy: 'public' })],
    });
    await render(<Groups />);
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText('2 waiting to join')).toBeTruthy();
    expect(screen.getByText(/Dogs · Public · 4 members · Downtown/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Dogs' }));
    expect(hooks.useGroups).toHaveBeenLastCalledWith({ interestId: 1 });
    await fireEvent.press(screen.getByRole('button', { name: 'Group Dog walkers' }));
    expect(mockPush).toHaveBeenCalledWith('/groups/g2');
  });

  it('invites starting the first group', async () => {
    (hooks.useGroups as jest.Mock).mockReturnValue({ isPending: false, isError: false, data: [] });
    await render(<Groups />);
    expect(screen.getByText(/No groups near you yet/)).toBeTruthy();
  });
});

describe('New group', () => {
  it('forces kid groups to be private', async () => {
    const mutateAsync = jest.fn().mockResolvedValue('new-id');
    (hooks.useCreateGroup as jest.Mock).mockReturnValue(mutation({ mutateAsync }));
    await render(<NewGroup />);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Toddler parents');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Toddlers' }));
    expect(screen.getByText(/Groups about kids are always private/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Public' }));
    expect(screen.getByRole('checkbox', { name: 'Private' })).toBeChecked();
    await fireEvent.press(screen.getByRole('button', { name: 'Create group' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/groups/new-id'));
    expect(mutateAsync).toHaveBeenCalledWith({ name: 'Toddler parents', description: '', interestId: 3, privacy: 'private' });
  });
});

describe('Group page', () => {
  it('private group, not a member: request to join, no posts loaded', async () => {
    const join = mutation();
    (hooks.useJoinGroup as jest.Mock).mockReturnValue(join);
    (hooks.useGroup as jest.Mock).mockReturnValue({ isPending: false, data: group() });
    await render(<GroupPage />);
    expect(screen.getByText(/This group is private/)).toBeTruthy();
    expect(useGroupFeed).toHaveBeenLastCalledWith('g1', false);
    await fireEvent.press(screen.getByRole('button', { name: 'Request to join' }));
    expect(join.mutate).toHaveBeenCalled();
  });

  it('public group, not a member: reads posts and joins instantly', async () => {
    (hooks.useGroup as jest.Mock).mockReturnValue({ isPending: false, data: group({ privacy: 'public' }) });
    await render(<GroupPage />);
    expect(useGroupFeed).toHaveBeenLastCalledWith('g1', true);
    expect(screen.getByRole('button', { name: 'Join group' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Post in group' })).toBeNull();
  });

  it('pending request can be withdrawn', async () => {
    (hooks.useGroup as jest.Mock).mockReturnValue({ isPending: false, data: group({ myStatus: 'pending', myRole: 'member' }) });
    await render(<GroupPage />);
    expect(screen.getByText(/Request sent/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });

  it('moderators see requests and can approve; members can post in the group', async () => {
    const respond = mutation();
    (hooks.useRespondToRequest as jest.Mock).mockReturnValue(respond);
    (hooks.useGroup as jest.Mock).mockReturnValue({
      isPending: false,
      data: group({ myRole: 'moderator', myStatus: 'active', pendingCount: 1 }),
    });
    const roster: RosterEntry[] = [
      { profileId: 'p1', handle: 'raj', displayName: 'Raj', role: 'member', status: 'pending' },
      { profileId: 'me', handle: 'mia', displayName: 'Mia', role: 'moderator', status: 'active' },
      { profileId: 'p2', handle: 'olga', displayName: 'Olga', role: 'owner', status: 'active' },
    ];
    (hooks.useRoster as jest.Mock).mockReturnValue({ data: roster });
    await render(<GroupPage />);

    await fireEvent.press(screen.getByRole('button', { name: 'Approve raj' }));
    expect(respond.mutate).toHaveBeenCalledWith({ profileId: 'p1', approve: true }, expect.anything());

    await fireEvent.press(screen.getByRole('button', { name: 'Members (2)' }));
    expect(screen.queryByRole('button', { name: 'Remove olga' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove mia' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Post in group' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/new-post', params: { groupId: 'g1', groupName: 'Toddler parents' } });
  });

  it('shows a clear message when the group is not available', async () => {
    (hooks.useGroup as jest.Mock).mockReturnValue({ isPending: false, isError: false, data: null });
    await render(<GroupPage />);
    expect(screen.getByText(/isn’t available in your area/)).toBeTruthy();
  });
});
