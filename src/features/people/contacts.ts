import { Fields, getContactsAsync, requestPermissionsAsync } from 'expo-contacts/legacy';
import { Platform } from 'react-native';

export type ContactsResult = { status: 'ok'; emails: string[] } | { status: 'denied' | 'unsupported' };

// Reads only the email addresses from the phone's contacts. Names, numbers and
// everything else are never requested.
export async function readContactEmails(): Promise<ContactsResult> {
  if (Platform.OS === 'web') return { status: 'unsupported' };
  const { status } = await requestPermissionsAsync();
  if (status !== 'granted') return { status: 'denied' };
  const { data } = await getContactsAsync({ fields: [Fields.Emails] });
  const emails = data.flatMap((c) => (c.emails ?? []).map((e) => e.email ?? '')).filter(Boolean);
  return { status: 'ok', emails };
}
