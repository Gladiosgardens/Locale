import { checkItemLink, formatPrice, parsePriceCents } from '@/features/items/link';

describe('checkItemLink (mirrors the database rules)', () => {
  it.each([
    ['https://WWW.Ikea.com/us/en/p/sofa?x=1#y', 'www.ikea.com'],
    ['https://shop.example.co.uk:8443/a', 'shop.example.co.uk'],
    ['https://example.com./a', 'example.com'],
    ['  https://example.com  ', 'example.com'],
  ])('accepts %s', (url, host) => {
    expect(checkItemLink(url)).toEqual({ ok: true, host });
  });

  it.each([
    'http://example.com/a',
    'HTTPS://example.com/a',
    'https://ikea.com@evil.example/a',
    'https://192.168.1.10/a',
    'https://аpple.com/a',
    'https://localhost/a',
    'https://example.com/a b',
    'example.com',
    `https://example.com/${'a'.repeat(2000)}`,
  ])('rejects %s', (url) => {
    expect(checkItemLink(url)).toEqual({ ok: false, error: 'invalid_url' });
  });

  it('rejects link shorteners', () => {
    expect(checkItemLink('https://bit.ly/3xyz')).toEqual({ ok: false, error: 'shortened_url' });
    expect(checkItemLink('https://amzn.to/abc')).toEqual({ ok: false, error: 'shortened_url' });
  });
});

describe('prices', () => {
  it('parses common inputs to cents', () => {
    expect(parsePriceCents('24.99')).toBe(2499);
    expect(parsePriceCents('$1,299')).toBe(129900);
    expect(parsePriceCents('15')).toBe(1500);
    expect(parsePriceCents('  ')).toBeNull();
    expect(parsePriceCents('abc')).toBeNaN();
    expect(parsePriceCents('1.999')).toBeNaN();
  });

  it('formats with the currency', () => {
    expect(formatPrice(89900, 'USD')).toMatch(/899/);
  });
});
