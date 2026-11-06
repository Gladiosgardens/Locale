// Mux playback addresses. Playback IDs only reach the app for posts the viewer may see.
export const playbackUrl = (playbackId: string) => `https://stream.mux.com/${playbackId}.m3u8`;
export const thumbnailUrl = (playbackId: string, width = 720) =>
  `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${width}&time=1`;

export const MAX_VIDEO_MS = 60_500;
