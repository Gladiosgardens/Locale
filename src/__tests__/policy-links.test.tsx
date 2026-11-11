import { fireEvent, render, screen } from '@testing-library/react-native';
import SignIn from '@/app/(auth)/sign-in';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
const WebBrowser = jest.requireMock('expo-web-browser');

it('links the terms and privacy policy from sign-in', async () => {
  await render(<SignIn />);
  await fireEvent.press(screen.getByRole('link', { name: 'Terms' }));
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://shoplocale.app/terms');
  await fireEvent.press(screen.getByRole('link', { name: 'Privacy Policy' }));
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://shoplocale.app/privacy');
});
