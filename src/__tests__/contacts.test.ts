import { getContactsAsync, requestPermissionsAsync } from 'expo-contacts/legacy';
import { readContactEmails } from '@/features/people/contacts';

jest.mock('expo-contacts/legacy', () => ({
  Fields: { Emails: 'emails' },
  requestPermissionsAsync: jest.fn(),
  getContactsAsync: jest.fn(),
}));

it('asks only for email addresses and flattens them', async () => {
  (requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (getContactsAsync as jest.Mock).mockResolvedValue({
    data: [{ emails: [{ email: 'a@x.com' }, { email: 'b@x.com' }] }, { emails: undefined }, { emails: [{}] }],
  });
  expect(await readContactEmails()).toEqual({ status: 'ok', emails: ['a@x.com', 'b@x.com'] });
  expect(getContactsAsync).toHaveBeenCalledWith({ fields: ['emails'] });
});

it('reads nothing without permission', async () => {
  (requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  (getContactsAsync as jest.Mock).mockClear();
  expect(await readContactEmails()).toEqual({ status: 'denied' });
  expect(getContactsAsync).not.toHaveBeenCalled();
});
