import { router } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect } from 'react';

const URL_RE = /https:\/\/[^\s<>"']+/i;

/** The first https link in what was shared (stores share "Look at this https://…"). */
export function sharedLink(shared: { webUrl?: string | null; text?: string | null }): string | null {
  const candidate = shared.webUrl ?? URL_RE.exec(shared.text ?? '')?.[0] ?? null;
  return candidate && candidate.startsWith('https://') ? candidate.replace(/[).,!?]+$/, '') : null;
}

// When someone shares a product page to Locale from a store's app or browser,
// open a new post with that item ready to tag on their own photo.
export function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (!hasShareIntent) return;
    const url = sharedLink(shareIntent);
    resetShareIntent();
    if (url) router.push({ pathname: '/new-post', params: { sharedUrl: url } });
  }, [hasShareIntent, shareIntent, resetShareIntent]);
  return null;
}
