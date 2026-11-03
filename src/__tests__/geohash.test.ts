import { encodeGeohash, geohashCenter } from '@/features/onboarding/geohash';

describe('geohash', () => {
  it('matches the reference encoding', () => {
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
  });

  it('uses 5 characters for areas by default', () => {
    expect(encodeGeohash(37.3382, -121.8863)).toHaveLength(5);
  });

  it('decodes to a centre inside the same cell', () => {
    const hash = encodeGeohash(37.3382, -121.8863);
    const c = geohashCenter(hash);
    expect(encodeGeohash(c.lat, c.lng)).toBe(hash);
    expect(Math.abs(c.lat - 37.3382)).toBeLessThan(0.03);
    expect(Math.abs(c.lng - -121.8863)).toBeLessThan(0.03);
  });

  it('rejects invalid input', () => {
    expect(() => encodeGeohash(91, 0)).toThrow(RangeError);
    expect(() => geohashCenter('abc')).toThrow(RangeError);
  });
});
