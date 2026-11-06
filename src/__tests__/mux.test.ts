import { authHeader, parseAsset, parseUpload, uploadRequest, videoState } from '../../supabase/functions/_shared/mux';

const asset = (over: Record<string, unknown> = {}) => ({
  data: {
    status: 'ready',
    duration: 12.345,
    passthrough: 'u1',
    playback_ids: [{ id: 'signedOne', policy: 'signed' }, { id: 'pub123456', policy: 'public' }],
    tracks: [{ type: 'audio' }, { type: 'video', max_width: 1080, max_height: 1920 }],
    ...over,
  },
});

describe('mux helpers', () => {
  it('builds a basic auth header and an upload that remembers who uploaded', () => {
    expect(authHeader({ id: 'id', secret: 'sec' })).toBe(`Basic ${btoa('id:sec')}`);
    expect(uploadRequest('u1').new_asset_settings).toEqual(
      expect.objectContaining({ passthrough: 'u1', playback_policy: ['public'], video_quality: 'basic' }),
    );
  });

  it('reads upload states', () => {
    expect(parseUpload({ data: { status: 'waiting' } })).toEqual({ status: 'waiting', assetId: null });
    expect(parseUpload({ data: { status: 'asset_created', asset_id: 'a1' } })).toEqual({ status: 'asset_created', assetId: 'a1' });
    expect(parseUpload({ data: { status: 'timed_out' } }).status).toBe('failed');
    expect(parseUpload(null).status).toBe('failed');
  });

  it('accepts a ready video of the right owner and length', () => {
    expect(parseAsset(asset(), 'u1')).toEqual({ status: 'ready', playbackId: 'pub123456', duration: 12.3, width: 1080, height: 1920 });
  });

  it('refuses someone else’s video, long videos, and broken ones', () => {
    expect(parseAsset(asset(), 'u2')).toEqual({ status: 'failed', reason: 'not_yours' });
    expect(parseAsset(asset({ duration: 61.2 }), 'u1')).toEqual({ status: 'failed', reason: 'too_long' });
    expect(parseAsset(asset({ duration: 60.8 }), 'u1').status).toBe('ready');
    expect(parseAsset(asset({ status: 'errored' }), 'u1')).toEqual({ status: 'failed', reason: 'errored' });
    expect(parseAsset(asset({ playback_ids: [{ id: 'x', policy: 'signed' }] }), 'u1')).toEqual({ status: 'failed', reason: 'no_playback' });
    expect(parseAsset(asset({ status: 'preparing' }), 'u1')).toEqual({ status: 'processing' });
  });

  it('follows an upload through to its asset', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'asset_created', asset_id: 'a1' } }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => asset() } as Response);
    const state = await videoState({ id: 'i', secret: 's' }, 'up1', 'u1');
    expect(state).toEqual(expect.objectContaining({ status: 'ready', assetId: 'a1', playbackId: 'pub123456' }));
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mux.com/video/v1/uploads/up1');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.mux.com/video/v1/assets/a1');
    fetchMock.mockRestore();
  });
});
