import { extractOffer } from '../../supabase/functions/_shared/prices';

const ld = (data: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`;

describe('extractOffer', () => {
  it('reads a Product offer from JSON-LD', () => {
    expect(
      extractOffer(ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Lamp', offers: { '@type': 'Offer', price: '129.00', priceCurrency: 'usd', availability: 'https://schema.org/InStock' } })),
    ).toEqual({ priceCents: 12900, currency: 'USD', inStock: true });
  });
  it('handles @graph, offer arrays, aggregate low prices and sold-out items', () => {
    expect(
      extractOffer(ld({ '@graph': [{ '@type': 'WebPage' }, { '@type': ['Product'], offers: [{ '@type': 'AggregateOffer', lowPrice: 49.5, priceCurrency: 'EUR', availability: 'OutOfStock' }] }] })),
    ).toEqual({ priceCents: 4950, currency: 'EUR', inStock: false });
  });
  it('skips broken JSON and falls back to meta tags', () => {
    const html = `<script type="application/ld+json">{oops</script>
      <meta property="product:price:amount" content="1,299.99"><meta content="GBP" property="product:price:currency">`;
    expect(extractOffer(html)).toEqual({ priceCents: 129999, currency: 'GBP', inStock: null });
  });
  it('returns null when there is no price', () => {
    expect(extractOffer('<html><body>Hello</body></html>')).toBeNull();
    expect(extractOffer(ld({ '@type': 'Product', offers: { price: '0', priceCurrency: 'USD' } }))).toBeNull();
  });
});
