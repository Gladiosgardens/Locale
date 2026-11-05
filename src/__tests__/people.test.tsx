import { createHash } from 'node:crypto';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
import FindFriends from '@/app/(app)/find-friends';
import { hashEmails, suggestionNote } from '@/features/people/api';
import * as peopleHooks from '@/features/people/hooks';
import { profileLink } from '@/features/people/invite';
import { PersonRow } from '@/features/people/PersonRow';
import { QrCode } from '@/features/people/QrCode';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_alg: string, value: string) =>
    jest.requireActual('node:crypto').createHash('sha256').update(value).digest('hex'),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/features/people/contacts', () => ({ readContactEmails: jest.fn() }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/features/onboarding/hooks', () => ({ useMyProfile: () => ({ data: { handle: 'moh', display_name: 'Moh' } }) }));

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const person = (id: string, over = {}) => ({ id, handle: id, displayName: `Name ${id}`, iFollow: false, note: null, ...over });

describe('people api', () => {
  it('hashes each distinct, valid email after lowercasing and trimming', async () => {
    const hashes = await hashEmails([' Ana@Example.com', 'ana@example.com', 'not an email', 'ben@example.org']);
    expect(hashes).toEqual([sha('ana@example.com'), sha('ben@example.org')]);
  });

  it('explains why someone is suggested', () => {
    expect(suggestionNote({ reason: 'follows_you', mutual_count: 0, mutual_name: null })).toBe('Follows you');
    expect(suggestionNote({ reason: 'mutual', mutual_count: 1, mutual_name: 'Ben' })).toBe('Followed by Ben');
    expect(suggestionNote({ reason: 'mutual', mutual_count: 3, mutual_name: 'Ben' })).toBe('Followed by Ben and 2 more');
    expect(suggestionNote({ reason: 'new', mutual_count: 0, mutual_name: null })).toBe('New on Locale');
  });

  it('links to profiles by handle', () => {
    expect(profileLink('moh')).toBe('locale://u/moh');
  });
});

describe('PersonRow', () => {
  it('follows and unfollows right away, and rolls back on error', async () => {
    const mutate = jest.fn();
    jest.spyOn(peopleHooks, 'useFollowPerson').mockReturnValue({ mutate } as never);
    await render(<PersonRow person={person('ana', { note: 'Follows you' })} />);
    expect(screen.getByText('@ana, follows you')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Follow Name ana' }));
    expect(mutate).toHaveBeenCalledWith({ id: 'ana', follow: true }, expect.anything());
    expect(screen.getByRole('button', { name: 'Unfollow Name ana' })).toBeTruthy();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => mutate.mock.calls[0][1].onError(new Error('x')));
    expect(screen.getByRole('button', { name: 'Follow Name ana' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'Open Name ana’s profile' }));
    expect(mockPush).toHaveBeenCalledWith('/profile/ana');
  });
});

it('draws a QR code', async () => {
  await render(<QrCode value="locale://u/moh" size={200} />);
  expect(screen.getByLabelText('QR code for your profile')).toBeTruthy();
});

describe('Find friends', () => {
  const contacts = { mutate: jest.fn(), isPending: false, data: undefined as unknown };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(peopleHooks, 'useFollowPerson').mockReturnValue({ mutate: jest.fn() } as never);
    jest.spyOn(peopleHooks, 'useSuggestions').mockReturnValue({
      data: [person('dev', { note: 'Followed by Ben' })], isPending: false, isError: false,
    } as never);
    jest.spyOn(peopleHooks, 'usePeopleSearch').mockImplementation(
      (q: string) => ({ data: q.length >= 2 ? [person('cleo')] : undefined, isPending: false, isError: false }) as never,
    );
    contacts.data = undefined;
    jest.spyOn(peopleHooks, 'useFindContacts').mockReturnValue(contacts as never);
  });
  afterEach(() => jest.useRealTimers());

  it('shows suggestions, invites, the QR code and search', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await render(<FindFriends />);
    expect(screen.getByText('@dev, followed by Ben')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Invite friends' }));
    expect(share).toHaveBeenCalledWith({ message: 'Follow me on Locale: locale://u/moh', url: 'locale://u/moh' });
    await fireEvent.press(screen.getByRole('button', { name: 'Your QR code' }));
    expect(mockPush).toHaveBeenCalledWith('/qr');
    await fireEvent.changeText(screen.getByLabelText('Search people by name or username'), 'cl');
    await act(async () => {
      jest.advanceTimersByTime(350);
    });
    expect(screen.getByRole('button', { name: 'Follow Name cleo' })).toBeTruthy();
    expect(screen.queryByText('Suggested for you')).toBeNull();
  });

  it('explains contacts matching before reading anything, then lists matches', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<FindFriends />);
    await fireEvent.press(screen.getByRole('button', { name: 'Contacts' }));
    expect(alert.mock.calls[0][1]).toMatch(/scrambled on your phone/);
    expect(contacts.mutate).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Continue')!.onPress!();
    expect(contacts.mutate).toHaveBeenCalled();

    contacts.data = { status: 'ok', checked: 12, people: [person('eli', { note: 'In your contacts' })] };
    await render(<FindFriends />);
    expect(screen.getByText('From your contacts')).toBeTruthy();
    expect(screen.getByText('@eli, in your contacts')).toBeTruthy();
  });
});
