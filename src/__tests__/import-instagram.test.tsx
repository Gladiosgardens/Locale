import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import ImportInstagram from '@/app/(app)/import-instagram';
import * as download from '@/features/instagram/download';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }));
jest.mock('@/features/instagram/download', () => ({
  INSTAGRAM_DOWNLOAD_URL: 'https://accountscenter.instagram.com/info_and_permissions/dyi/',
  MAX_IMPORT: 10,
  pickDownload: jest.fn(),
  openDownload: jest.fn(),
  importedKeys: jest.fn(),
  importPost: jest.fn(),
}));
const dl = download as jest.Mocked<typeof download>;

const opened = {
  posts: [
    { key: 'ig:2:b', caption: 'Kitchen', takenAt: '2024-02-01T00:00:00.000Z', photos: ['m/2.jpg', 'm/3.jpg'] },
    { key: 'ig:1:a', caption: 'Living room', takenAt: '2023-05-13T00:00:00.000Z', photos: ['m/1.jpg'] },
  ],
  videosSkipped: 2,
  photoUri: jest.fn(async (n: string) => `file:///cache/${n}`),
  close: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  dl.pickDownload.mockResolvedValue({ uri: 'file:///instagram.zip' } as never);
  dl.openDownload.mockResolvedValue(opened);
  dl.importedKeys.mockResolvedValue(new Set(['ig:2:b']));
});

it('explains how to get the download and opens Instagram’s page', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await render(<ImportInstagram />);
  expect(screen.getByText('Ask Instagram for your posts')).toBeTruthy();
  expect(screen.getByText(/set Format to JSON/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Open Instagram’s download page' }));
  expect(open).toHaveBeenCalledWith('https://accountscenter.instagram.com/info_and_permissions/dyi/');
});

it('opens the file, locks imported posts, and imports the chosen ones', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  dl.importPost.mockResolvedValue('p1');
  await render(<ImportInstagram />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose download file' }));
  await waitFor(() => expect(screen.getByText('2 photo posts')).toBeTruthy());
  expect(screen.getByText(/2 video posts stay on Instagram/)).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: /^Kitchen, .*already imported$/ })).toBeDisabled();
  await fireEvent.press(screen.getByRole('checkbox', { name: /^Living room/ }));
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Import 1 post' })));
  expect(dl.importPost).toHaveBeenCalledWith('u1', opened, opened.posts[1]);
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Imported 1 post', expect.stringMatching(/original dates/)));
  expect(screen.getByRole('checkbox', { name: /^Living room, .*already imported$/ })).toBeTruthy();
});

it('explains a file it can’t use', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  dl.openDownload.mockRejectedValue(new Error('export_is_html'));
  await render(<ImportInstagram />);
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Choose download file' })));
  expect(alert).toHaveBeenCalledWith('Couldn’t open that file', expect.stringMatching(/Format set to JSON/));
});

it('stops at the daily post limit', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  dl.importedKeys.mockResolvedValue(new Set());
  dl.importPost.mockRejectedValue(new Error('post_rate_limited'));
  await render(<ImportInstagram />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose download file' }));
  await waitFor(() => expect(screen.getByText('2 photo posts')).toBeTruthy());
  await fireEvent.press(screen.getByRole('checkbox', { name: /^Kitchen/ }));
  await fireEvent.press(screen.getByRole('checkbox', { name: /^Living room/ }));
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Import 2 posts' })));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Nothing was imported', expect.stringMatching(/limit of 20/)));
  expect(dl.importPost).toHaveBeenCalledTimes(1);
});
