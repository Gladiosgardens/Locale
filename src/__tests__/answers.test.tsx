import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import Answers from '@/app/(app)/answers/[postId]';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({ postId: 'p1' }) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
let mockMe = 'ben';
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: mockMe } } }) }));
jest.mock('@/features/posts/hooks', () => ({
  usePost: () => ({
    data: { id: 'p1', caption: 'Saw this lamp at a cafe', author: { id: 'ana', handle: 'ana', displayName: 'Ana' }, media: [{ url: null }], asking: true },
    isPending: false,
  }),
}));
const mockSubmit = jest.fn();
const mockAccept = jest.fn();
const mockRemove = jest.fn();
const mockSetAsking = jest.fn();
const answer = (over: object) => ({
  id: 'a1', answerer: { id: 'cy', handle: 'cy', displayName: 'Cy' }, title: 'Brass mushroom lamp', storeName: 'Lamp Co',
  url: 'https://lamps.example.com/m', urlHost: 'lamps.example.com', priceCents: 12900, currency: 'USD', note: null,
  accepted: false, createdAt: new Date().toISOString(), isMine: false, canAccept: false, ...over,
});
let mockAnswers: object[] = [];
jest.mock('@/features/answers/hooks', () => ({
  useAnswers: () => ({ data: mockAnswers, isPending: false }),
  useSubmitAnswer: () => ({ mutate: mockSubmit, isPending: false }),
  useAcceptAnswer: () => ({ mutate: mockAccept }),
  useDeleteAnswer: () => ({ mutate: mockRemove }),
  useSetAsking: () => ({ mutate: mockSetAsking, isPending: false }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = 'ben';
  mockAnswers = [answer({})];
});

describe('Where’s this from?', () => {
  it('lets others suggest an answer with a link', async () => {
    await render(<Answers />);
    expect(screen.getByText('Brass mushroom lamp')).toBeTruthy();
    expect(screen.getByText('Lamp Co, lamps.example.com, $129.00')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
    expect(screen.getByText(/Say what it is/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What it is'), 'Mushroom lamp');
    await fireEvent.changeText(screen.getByLabelText('Link to the item'), 'https://shop.example.com/lamp');
    await fireEvent.changeText(screen.getByLabelText('Price in US dollars'), '$89.50');
    await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
    expect(mockSubmit).toHaveBeenCalledWith(
      { title: 'Mushroom lamp', url: 'https://shop.example.com/lamp', storeName: '', priceCents: 8950, note: '' },
      expect.anything(),
    );
  });

  it('lets the poster add an answer to the post and stop asking', async () => {
    mockMe = 'ana';
    mockAnswers = [answer({ canAccept: true })];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<Answers />);
    expect(screen.queryByRole('button', { name: 'Send answer' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Add to post' }));
    expect(alert).toHaveBeenCalledWith('Add “Brass mushroom lamp” to your post?', expect.stringMatching(/@cy earns/), expect.anything());
    (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[])[1].onPress!();
    expect(mockAccept).toHaveBeenCalledWith('a1', expect.anything());
    await fireEvent.press(screen.getByRole('button', { name: 'Found it: stop asking' }));
    await waitFor(() => expect(mockSetAsking).toHaveBeenCalledWith(false, expect.anything()));
  });

  it('shows accepted answers and lets answerers withdraw pending ones', async () => {
    mockAnswers = [answer({ id: 'a2', accepted: true }), answer({ id: 'a3', isMine: true, title: 'My guess' })];
    await render(<Answers />);
    expect(screen.getByText('Added to the post')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Withdraw' }));
    expect(mockRemove).toHaveBeenCalledWith('a3', expect.anything());
  });
});
