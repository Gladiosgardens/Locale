import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import Settings from '@/app/(app)/settings';
import { ReportSheet } from '@/features/safety/ReportSheet';
import { useBlocked, useReport, useUnblockUser } from '@/features/safety/hooks';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me', email: 'me@example.com' } } }) }));
jest.mock('@/features/auth/api', () => ({ signOut: jest.fn() }));
jest.mock('@/features/onboarding/hooks', () => ({
  useMyProfile: () => ({ data: { display_name: 'Maya', handle: 'maya', area: { id: 'a', name: 'Downtown' } } }),
}));
jest.mock('@/features/safety/hooks', () => ({ useBlocked: jest.fn(), useUnblockUser: jest.fn(), useReport: jest.fn() }));
const mockPolicyUpdate = jest.fn();
const mockNotifyUpdate = jest.fn();
const mockEnable = jest.fn();
let mockPermission = 'undetermined';
jest.mock('@/features/settings/hooks', () => ({
  usePrivateSettings: () => ({
    query: { data: { dmPolicy: 'everyone', notifyMessages: true, notifyGroups: true } },
    setDmPolicy: { mutate: mockPolicyUpdate },
    setNotifications: { mutate: mockNotifyUpdate },
  }),
}));
jest.mock('@/features/notifications/PushPrompt', () => ({
  usePushPermission: () => ({ data: mockPermission }),
  useEnablePush: () => ({ enable: mockEnable, busy: false }),
}));

beforeEach(() => jest.clearAllMocks());

describe('ReportSheet', () => {
  it('needs a reason, sends it with details, and explains child-safety hiding', async () => {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    (useReport as jest.Mock).mockReturnValue({ mutateAsync, isPending: false });
    await render(<ReportSheet subject={{ type: 'post', id: 'p1', label: 'post' }} onClose={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Child safety' }));
    await fireEvent.changeText(screen.getByLabelText('Details (optional)'), 'Shows a child’s face and school');
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(screen.getByText(/hidden for everyone while we review/)).toBeTruthy());
    expect(mutateAsync).toHaveBeenCalledWith({
      targetType: 'post', targetId: 'p1', reason: 'child_safety', details: 'Shows a child’s face and school',
    });
  });

  it('shows a friendly error', async () => {
    (useReport as jest.Mock).mockReturnValue({ mutateAsync: jest.fn().mockRejectedValue(new Error('report_rate_limited')), isPending: false });
    await render(<ReportSheet subject={{ type: 'profile', id: 'u1', label: '@ben' }} onClose={jest.fn()} />);
    expect(screen.getByText('Report @ben')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Spam' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText(/a lot of reports today/)).toBeTruthy();
  });
});

describe('Settings', () => {
  it('lists blocked accounts and unblocks after confirming', async () => {
    const mutate = jest.fn();
    (useUnblockUser as jest.Mock).mockReturnValue({ mutate });
    (useBlocked as jest.Mock).mockReturnValue({
      isPending: false, isError: false, data: [{ profileId: 'u2', handle: 'ben', displayName: 'Ben' }],
    });
    const alert = jest.spyOn(Alert, 'alert');
    await render(<Settings />);
    expect(screen.getByText('me@example.com')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Unblock ben' }));
    const buttons = alert.mock.calls[0][2]!;
    buttons.find((b) => b.text === 'Unblock')!.onPress!();
    expect(mutate).toHaveBeenCalledWith('u2', expect.anything());
  });

  it('lets people limit messages to connections', async () => {
    (useUnblockUser as jest.Mock).mockReturnValue({ mutate: jest.fn() });
    (useBlocked as jest.Mock).mockReturnValue({ isPending: false, isError: false, data: [] });
    await render(<Settings />);
    expect(screen.getByRole('checkbox', { name: 'Everyone' })).toBeChecked();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Connections only' }));
    expect(mockPolicyUpdate).toHaveBeenCalledWith('connections', expect.anything());
  });

  it('turns on notifications and mutes categories', async () => {
    mockPermission = 'undetermined';
    (useUnblockUser as jest.Mock).mockReturnValue({ mutate: jest.fn() });
    (useBlocked as jest.Mock).mockReturnValue({ isPending: false, isError: false, data: [] });
    await render(<Settings />);
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on notifications' }));
    expect(mockEnable).toHaveBeenCalled();
    await fireEvent(screen.getByLabelText('Notify me about messages'), 'valueChange', false);
    expect(mockNotifyUpdate).toHaveBeenCalledWith({ messages: false }, expect.anything());
  });

  it('says when notifications are on, without offering the button', async () => {
    mockPermission = 'granted';
    (useUnblockUser as jest.Mock).mockReturnValue({ mutate: jest.fn() });
    (useBlocked as jest.Mock).mockReturnValue({ isPending: false, isError: false, data: [] });
    await render(<Settings />);
    expect(screen.getByText(/On for this phone/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull();
  });

  it('explains how to block when the list is empty', async () => {
    (useUnblockUser as jest.Mock).mockReturnValue({ mutate: jest.fn() });
    (useBlocked as jest.Mock).mockReturnValue({ isPending: false, isError: false, data: [] });
    await render(<Settings />);
    expect(screen.getByText(/haven’t blocked anyone/)).toBeTruthy();
  });
});
