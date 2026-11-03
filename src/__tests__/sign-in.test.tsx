import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SignIn from '@/app/(auth)/sign-in';
import { sendSignInCode } from '@/features/auth/api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/features/auth/api', () => ({ sendSignInCode: jest.fn() }));

describe('Sign in', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps the button disabled until the email looks valid', async () => {
    await render(<SignIn />);
    const button = screen.getByRole('button', { name: 'Send code' });
    expect(button).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    expect(button).toBeDisabled();
  });

  it('sends a code and moves to the verify screen', async () => {
    (sendSignInCode as jest.Mock).mockResolvedValue(undefined);
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByLabelText('Email'), ' Maya@Example.com ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({ pathname: '/verify', params: { email: 'maya@example.com' } }),
    );
    expect(sendSignInCode).toHaveBeenCalledWith(' Maya@Example.com ');
  });

  it('shows an error when sending fails', async () => {
    (sendSignInCode as jest.Mock).mockRejectedValue(new Error('rate limited'));
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'maya@example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't send a code/i);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
