import { Share } from 'react-native';

// Profile links open the app (locale://u/<handle>). Once Locale has public web
// pages, set EXPO_PUBLIC_WEB_URL so links work for people without the app too.
export function profileLink(handle: string): string {
  const web = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/+$/, '');
  return web ? `${web}/u/${handle}` : `locale://u/${handle}`;
}

export async function shareInvite(handle: string): Promise<void> {
  const url = profileLink(handle);
  await Share.share({ message: `Follow me on Locale: ${url}`, url });
}
