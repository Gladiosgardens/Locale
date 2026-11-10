import { normalizeStatus, parseImportRow, toCents, wrapLink } from '../../supabase/functions/_shared/affiliate';
import { expressAccountParams, formEncode, stripe, StripeError } from '../../supabase/functions/_shared/stripe';

describe('affiliate links', () => {
  it('wraps a link with the destination and our click id', () => {
    expect(wrapLink('https://net.example/?key=K&u={url}&sub={sub}', 'https://shop.com/a?b=1&c=2', 'abc-1')).toBe(
      'https://net.example/?key=K&u=https%3A%2F%2Fshop.com%2Fa%3Fb%3D1%26c%3D2&sub=abc-1',
    );
  });
  it('rejects a template without {url} or https', () => {
    expect(() => wrapLink('https://net.example/?key=K', 'https://shop.com', 'x')).toThrow();
    expect(() => wrapLink('http://net.example/?u={url}', 'https://shop.com', 'x')).toThrow();
  });
});

describe('commission imports', () => {
  it('normalizes network statuses', () => {
    expect(['Pending', 'approved', 'PAID', 'declined', 'Canceled', 'weird'].map(normalizeStatus)).toEqual([
      'pending', 'locked', 'locked', 'reversed', 'reversed', null,
    ]);
  });
  it('reads money in common formats', () => {
    expect([toCents('12.34'), toCents('$1,234.50'), toCents(7.5), toCents('-3'), toCents('abc')]).toEqual([1234, 123450, 750, null, null]);
  });
  it('parses a row and explains a bad one', () => {
    expect(
      parseImportRow({ external_id: 9, sub_id: ' c1 ', commission: '4.20', sale: '42', currency: 'eur', status: 'Approved', occurred_at: '2026-11-01' }),
    ).toEqual({
      externalId: '9', subId: 'c1', commissionCents: 420, saleCents: 4200, currency: 'EUR', status: 'locked',
      occurredAt: '2026-11-01T00:00:00.000Z',
    });
    expect(parseImportRow({ external_id: 'x', commission: '1', status: 'meh', occurred_at: '2026-11-01' })).toEqual({
      error: 'unknown status "meh" for x',
    });
  });
});

describe('Stripe client', () => {
  it('form-encodes nested params', () => {
    expect(formEncode({ a: 1, b: { c: 'x y', d: { e: true } }, skip: undefined })).toBe('a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5Be%5D=true');
  });
  it('asks for the recipient agreement outside the US', () => {
    expect(expressAccountParams('eg', 'p1')).toMatchObject({ country: 'EG', tos_acceptance: { service_agreement: 'recipient' } });
    expect(expressAccountParams('US', 'p1')).not.toHaveProperty('tos_acceptance');
  });
  it('sends auth and idempotency, and surfaces Stripe errors', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'tr_1' }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: 'Insufficient funds', code: 'balance_insufficient' } }) });
    await expect(stripe('sk', 'POST', '/transfers', { amount: 100 }, 'po_1', fetchImpl)).resolves.toEqual({ id: 'tr_1' });
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer sk', 'Idempotency-Key': 'po_1' });
    await expect(stripe('sk', 'POST', '/transfers', { amount: 100 }, undefined, fetchImpl)).rejects.toEqual(
      new StripeError('Insufficient funds', 400, 'balance_insufficient'),
    );
  });
});
