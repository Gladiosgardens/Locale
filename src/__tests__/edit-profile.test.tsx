import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import EditProfile from '@/app/(app)/edit-profile';
import { updateProfile } from '@/features/profiles/api';

const mockBack = jest.fn();
const mockInvalidate = jest.fn();
jest.mock('expo-router', () => ({ router: { back: () => mockBack(), push: jest.fn() } }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/features/posts/api', () => ({ uploadPhoto: jest.fn() }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/features/profiles/api', () => ({ updateProfile: jest.fn(), setAvatar: jest.fn() }));
jest.mock('@/features/profiles/hooks', () => ({
  useProfile: () => ({ data: { id: 'me', handle: 'moh', displayName: 'Moh', bio: 'Hi' } }),
}));

beforeEach(() => jest.clearAllMocks());

it('saves name, username and bio, then goes back', async () => {
  (updateProfile as jest.Mock).mockResolvedValue(undefined);
  await render(<EditProfile />);
  expect(screen.getByLabelText('Username').props.value).toBe('moh');
  await fireEvent.changeText(screen.getByLabelText('Bio'), 'Coffee and chairs');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(updateProfile).toHaveBeenCalledWith('me', expect.objectContaining({ handle: 'moh', displayName: 'Moh', bio: 'Coffee and chairs' }));
  expect(mockInvalidate).toHaveBeenCalled();
});

it('shows a taken username without leaving', async () => {
  (updateProfile as jest.Mock).mockRejectedValue(new Error('handle_taken'));
  await render(<EditProfile />);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(mockBack).not.toHaveBeenCalled();
});
