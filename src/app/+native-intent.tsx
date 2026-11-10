import { getShareExtensionKey } from 'expo-share-intent';

// The iOS share extension opens the app with a special link
// (locale://dataUrl=localeShareKey). Send it home; ShareIntentHandler then
// picks up the shared link.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/';
  } catch {
    // fall through to the normal route
  }
  return path;
}
