import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

export const STORY_SIZE = { width: 1080, height: 1920 };

/** Renders the story card to a 1080x1920 PNG and returns its file URI. */
export function captureStory(view: Parameters<typeof captureRef>[0]): Promise<string> {
  return captureRef(view, { format: 'png', result: 'tmpfile', ...STORY_SIZE });
}

export type ShareResult = 'shared' | 'unavailable';

// Opens the phone's share sheet with the image: Instagram, Snapchat, TikTok,
// Facebook and any other installed app that takes photos. Opening one of them
// directly would need that company's developer kit and app ID.
export async function shareStoryImage(uri: string): Promise<ShareResult> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share to Stories' });
  return 'shared';
}
