// Geohash encode/decode. Area cells use precision 5 (~4.9 km x 4.9 km).
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export const AREA_PRECISION = 5;

export function encodeGeohash(lat: number, lng: number, precision = AREA_PRECISION): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new RangeError('invalid coordinates');
  }
  let latLo = -90, latHi = 90, lngLo = -180, lngHi = 180;
  let hash = '';
  let bit = 0, idx = 0, isLng = true;
  while (hash.length < precision) {
    if (isLng) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) { idx = (idx << 1) | 1; lngLo = mid; } else { idx <<= 1; lngHi = mid; }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) { idx = (idx << 1) | 1; latLo = mid; } else { idx <<= 1; latHi = mid; }
    }
    isLng = !isLng;
    if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

// Centre of a cell; matches public.geohash_center on the server.
export function geohashCenter(hash: string): { lat: number; lng: number } {
  let latLo = -90, latHi = 90, lngLo = -180, lngHi = 180;
  let isLng = true;
  for (const ch of hash.toLowerCase()) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new RangeError('invalid geohash');
    for (let b = 4; b >= 0; b--) {
      const on = (idx >> b) & 1;
      if (isLng) { const mid = (lngLo + lngHi) / 2; if (on) lngLo = mid; else lngHi = mid; }
      else { const mid = (latLo + latHi) / 2; if (on) latLo = mid; else latHi = mid; }
      isLng = !isLng;
    }
  }
  return { lat: (latLo + latHi) / 2, lng: (lngLo + lngHi) / 2 };
}
