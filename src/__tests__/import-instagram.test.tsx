import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ImportInstagram from '@/app/(app)/import-instagram';
import * as api from '@/features/instagram/api';
import * as hooks from '@/features/instagram/hooks';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(async () => ({ type: 'success' })) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
const WebBrowser = jest.requireMock('expo-web-browser');

const run = { mutate: jest.fn(), isPending: false };
const refetch = jest.fn();
function setup(connected: boolean) {
  jest.spyOn(hooks, 'useInstagramStatus').mockReturnValue({
    isPending: false, data: { connected, username: connected ? 'mo.home' : null, imported: 0 }, refetch,
  } as never);
  jest.spyOn(hooks, 'useInstagramMedia').mockReturnValue({
    isPending: false, isError: false, hasNextPage: false,
    data: { pages: [{ after: null, posts: [
      { id: '1', caption: 'Living room', takenAt: '2025-01-01', thumbnail: 'https://i/1', images: ['https://i/1'], imported: false },
      { id: '2', caption: 'Kitchen', takenAt: '2025-01-02', thumbnail: 'https://i/2', images: ['a', 'b'], imported: true },
    ] }] },
  } as never);
  jest.spyOn(hooks, 'useImportPosts').mockReturnValue(run as never);
  jest.spyOn(hooks, 'useDisconnectInstagram').mockReturnValue({ mutate: jest.fn() } as never);
}
beforeEach(() => jest.clearAllMocks());

it('connects through Instagram’s sign-in page', async () => {
  setup(false);
  jest.spyOn(api, 'connectUrl').mockResolvedValue('https://www.instagram.com/oauth/authorize?x');
  await render(<ImportInstagram />);
  expect(screen.getByText(/professional accounts/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Connect Instagram' }));
  await waitFor(() => expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith('https://www.instagram.com/oauth/authorize?x', 'locale://import-instagram'));
  expect(refetch).toHaveBeenCalled();
});

it('picks posts and imports them; already imported ones are locked', async () => {
  setup(true);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<ImportInstagram />);
  expect(screen.getByText('@mo.home')).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Kitchen, already imported' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Select posts to import' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Living room' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Import 1 post' }));
  expect(run.mutate).toHaveBeenCalledWith(['1'], expect.anything());
  await act(async () => run.mutate.mock.calls[0][1].onSuccess({ imported: ['1'], skipped: [] }));
  expect(alert.mock.calls[0][0]).toBe('Imported 1 post');
});
