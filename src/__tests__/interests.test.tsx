import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import InterestsStep from '@/app/(onboarding)/interests';
import { useInterests, useMyProfile, useSetInterests } from '@/features/onboarding/hooks';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/features/onboarding/hooks', () => ({
  useInterests: jest.fn(),
  useMyProfile: jest.fn(),
  useSetInterests: jest.fn(),
}));

const INTERESTS = [
  { id: 1, slug: 'dogs', label: 'Dogs', sort_order: 1, section: 'everyday' },
  { id: 2, slug: 'running', label: 'Running', sort_order: 2, section: 'active' },
  { id: 3, slug: 'coffee', label: 'Coffee', sort_order: 3, section: 'food' },
  { id: 4, slug: 'books', label: 'Books', sort_order: 4, section: 'everyday' },
  { id: 5, slug: 'tech', label: 'Tech & gadgets', sort_order: 5, section: 'tech' },
];

const mutateAsync = jest.fn();

function setup(data = INTERESTS) {
  (useInterests as jest.Mock).mockReturnValue({ isPending: false, isError: false, data, refetch: jest.fn() });
  (useMyProfile as jest.Mock).mockReturnValue({ data: { interestIds: [] } });
  (useSetInterests as jest.Mock).mockReturnValue({ mutateAsync, isPending: false });
}

describe('Interests step', () => {
  beforeEach(() => jest.clearAllMocks());

  it('groups topics into sections, in a fixed order, and never asks for gender', async () => {
    setup();
    await render(<InterestsStep />);
    const headers = screen.getAllByRole('header').map((h) => h.props.children);
    expect(headers).toEqual(['What are you into?', 'Tech & cars', 'Food & drink', 'Active & outdoors', 'Everyday']);
    expect(screen.queryByText(/gender|male|female/i)).toBeNull();
  });

  it('requires 3 picks before continuing, then saves them', async () => {
    setup();
    mutateAsync.mockResolvedValue(undefined);
    await render(<InterestsStep />);
    const cont = screen.getByRole('button', { name: 'Continue' });
    expect(cont).toBeDisabled();
    expect(screen.getByText('Pick 3 more')).toBeTruthy();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Dogs' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Running' }));
    expect(cont).toBeDisabled();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Coffee' }));
    expect(cont).toBeEnabled();

    await fireEvent.press(cont);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/profile'));
    expect(mutateAsync).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('shows an empty state when no interests are available', async () => {
    setup([]);
    await render(<InterestsStep />);
    expect(screen.getByText(/no interests are available/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('shows a friendly message when saving fails', async () => {
    setup();
    mutateAsync.mockRejectedValue(new Error('interest_count'));
    await render(<InterestsStep />);
    for (const name of ['Dogs', 'Running', 'Coffee']) {
      await fireEvent.press(screen.getByRole('checkbox', { name }));
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick between 3 and 15 interests.');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
