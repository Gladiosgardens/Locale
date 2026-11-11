import * as WebBrowser from 'expo-web-browser';

// Locale's website: landing page, policies and account deletion.
export const SITE_URL = 'https://shoplocale.app';
export const PRIVACY_URL = `${SITE_URL}/privacy`;
export const TERMS_URL = `${SITE_URL}/terms`;
export const DELETE_ACCOUNT_URL = `${SITE_URL}/delete-account`;

export function openPage(url: string): void {
  void WebBrowser.openBrowserAsync(url);
}
