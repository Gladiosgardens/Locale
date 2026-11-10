import { authorizeUrl, cleanCode, parseMediaPage } from '../../supabase/functions/_shared/instagram';

describe('Instagram helpers', () => {
  it('builds the authorize URL with the basic scope', () => {
    const u = new URL(authorizeUrl('123', 'https://ref.supabase.co/functions/v1/instagram-callback', 's'.repeat(40)));
    expect(u.origin + u.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: '123', redirect_uri: 'https://ref.supabase.co/functions/v1/instagram-callback', response_type: 'code',
      scope: 'instagram_business_basic', state: 's'.repeat(40),
    });
  });
  it('strips the #_ Instagram adds to codes', () => {
    expect(cleanCode('AQBx#_')).toBe('AQBx');
  });
  it('keeps photos and carousel photos, skips videos and reels', () => {
    const page = parseMediaPage({
      data: [
        { id: '1', media_type: 'IMAGE', media_url: 'https://cdn/1.jpg', caption: 'Desk', timestamp: '2024-05-01T10:00:00+0000' },
        { id: '2', media_type: 'VIDEO', media_url: 'https://cdn/2.mp4', timestamp: '2024-05-02T10:00:00+0000' },
        {
          id: '3', media_type: 'CAROUSEL_ALBUM', timestamp: '2024-05-03T10:00:00+0000',
          children: { data: [{ id: '3a', media_type: 'VIDEO', media_url: 'https://cdn/3a.mp4' }, { id: '3b', media_type: 'IMAGE', media_url: 'https://cdn/3b.jpg' }] },
        },
        { id: '4', media_type: 'IMAGE', timestamp: '2024-05-04T10:00:00+0000' },
      ],
      paging: { cursors: { after: 'CUR' }, next: 'https://graph.instagram.com/next' },
    });
    expect(page.posts.map((p) => [p.id, p.images])).toEqual([
      ['1', ['https://cdn/1.jpg']],
      ['3', ['https://cdn/3b.jpg']],
    ]);
    expect(page.posts[0]).toMatchObject({ caption: 'Desk', takenAt: '2024-05-01T10:00:00.000Z' });
    expect(page.after).toBe('CUR');
    expect(parseMediaPage({ data: [], paging: { cursors: { after: 'X' } } }).after).toBeNull();
  });
});
