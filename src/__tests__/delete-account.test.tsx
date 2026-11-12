import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import DeleteAccount from '@/app/(app)/delete-account';
import * as account from '@/features/account/api';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const remove = { mutate: jest.fn(), isPending: false, error: null };
function setup(over: Partial<account.DeletionSummary> = {}) {
  jest.spyOn(account, 'useDeletionSummary').mockReturnValue({
    isPending: false, data: { handle: 'dana', postCount: 3, unpaidCents: 0, payoutInProgress: false, ...over },
  } as never);
  jest.spyOn(account, 'useDeleteAccount').mockReturnValue(remove as never);
}
beforeEach(() => jest.clearAllMocks());

it('deletes only after typing the username and confirming', async () => {
  setup();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<DeleteAccount />);
  expect(screen.getByText(/your 3 posts/)).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Delete my account' });
  expect(button).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Type dana to confirm'), '@Dana');
  await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
  expect(alert.mock.calls[0][0]).toBe('Delete your account?');
  await act(async () => (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((b) => b.text === 'Delete')!.onPress!());
  expect(remove.mutate).toHaveBeenCalledWith('@Dana', expect.anything());
});

it('warns about unpaid earnings', async () => {
  setup({ unpaidCents: 1050 });
  await render(<DeleteAccount />);
  expect(screen.getByText(/\$10\.50 in earnings that haven’t been paid/)).toBeTruthy();
});

it('waits for a payout that is on its way', async () => {
  setup({ payoutInProgress: true });
  await render(<DeleteAccount />);
  expect(screen.getByText(/A payout is on its way/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Type dana to confirm'), 'dana');
  expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
});
