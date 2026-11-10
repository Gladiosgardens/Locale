import { isFetchableUrl, parseLinkPreview } from '../../supabase/functions/_shared/linkpreview';

describe('isFetchableUrl', () => {
  it('allows public https pages only', () => {
    expect(isFetchableUrl('https://www.zara.com/us/en/linen-shirt-p123.html')).toBe(true);
    for (const bad of ['http://shop.com/a', 'https://localhost/a', 'https://10.0.0.1/a', 'https://[::1]/a', 'https://intranet/a',
      'https://user:pw@shop.com/a', 'https://shop.com:8443/a', 'https://printer.local/a', 'not a url']) {
      expect([bad, isFetchableUrl(bad)]).toEqual([bad, false]);
    }
  });
});

describe('parseLinkPreview', () => {
  it('prefers schema.org Product data', () => {
    const html = `<title>Ignored</title><meta property="og:site_name" content="Lamp Co &amp; Sons">
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Product', name: 'Brass mushroom lamp', brand: { '@type': 'Brand', name: 'Lumo' }, image: ['/img/lamp.jpg'],
        offers: { price: '129', priceCurrency: 'USD' },
      })}</script>`;
    expect(parseLinkPreview(html, 'https://lamps.example.com/p/1')).toEqual({
      title: 'Brass mushroom lamp', brand: 'Lumo', store: 'Lamp Co & Sons', image: 'https://lamps.example.com/img/lamp.jpg',
      priceCents: 12900, currency: 'USD',
    });
  });
  it('falls back to Open Graph and the page title', () => {
    expect(parseLinkPreview('<meta property="og:title" content="Linen shirt"><meta property="og:image" content="http://x.com/a.jpg">', 'https://a.com')).toMatchObject({
      title: 'Linen shirt', image: null, priceCents: null,
    });
    expect(parseLinkPreview('<title> Oak desk | Shop </title>', 'https://a.com').title).toBe('Oak desk | Shop');
  });
});
