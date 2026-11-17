import { inflateSync } from 'fflate';

// A small ZIP reader that reads only what it needs: the central directory,
// then one entry at a time. Instagram downloads can be several gigabytes, so
// the whole file is never loaded into memory. Supports ZIP64.

export type RandomAccess = { size: number; read(offset: number, length: number): Promise<Uint8Array> };
export type ZipEntry = { name: string; method: number; compressedSize: number; size: number; localOffset: number };

export class ZipError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 0x100000000;

/** UTF-8 to string, without relying on TextDecoder (not available everywhere in React Native). */
export function decodeUtf8(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i++];
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c >= 0xc0 && c < 0xe0 && i < b.length) cp = ((c & 0x1f) << 6) | (b[i++] & 0x3f);
    else if (c >= 0xe0 && c < 0xf0 && i + 1 < b.length) cp = ((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    else if (c >= 0xf0 && i + 2 < b.length)
      cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    else cp = 0xfffd;
    out += String.fromCodePoint(cp);
  }
  return out;
}

export async function listEntries(src: RandomAccess): Promise<ZipEntry[]> {
  const tailLen = Math.min(src.size, 65_557);
  const tail = await src.read(src.size - tailLen, tailLen);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      e = i;
      break;
    }
  }
  if (e < 0) throw new ZipError('not_a_zip');
  let count = u16(tail, e + 10);
  let cdSize = u32(tail, e + 12);
  let cdOffset = u32(tail, e + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = e - 20;
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new ZipError('not_a_zip');
    const z = await src.read(u64(tail, loc + 8), 56);
    if (u32(z, 0) !== 0x06064b50) throw new ZipError('not_a_zip');
    count = u64(z, 32);
    cdSize = u64(z, 40);
    cdOffset = u64(z, 48);
  }
  const cd = await src.read(cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50) throw new ZipError('not_a_zip');
    const method = u16(cd, p + 10);
    let compressedSize = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let localOffset = u32(cd, p + 42);
    const name = decodeUtf8(cd.subarray(p + 46, p + 46 + nameLen));
    // ZIP64 extra field: the 64-bit values for whichever fields are 0xFFFFFFFF, in this order.
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = u16(cd, x);
      const len = u16(cd, x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (size === 0xffffffff) {
          size = u64(cd, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(cd, q);
          q += 8;
        }
        if (localOffset === 0xffffffff) localOffset = u64(cd, q);
      }
      x += 4 + len;
    }
    if (!name.endsWith('/')) entries.push({ name, method, compressedSize, size, localOffset });
    p = xEnd + commentLen;
  }
  return entries;
}

export async function readEntry(src: RandomAccess, entry: ZipEntry): Promise<Uint8Array> {
  const header = await src.read(entry.localOffset, 30);
  if (u32(header, 0) !== 0x04034b50) throw new ZipError('bad_entry');
  const start = entry.localOffset + 30 + u16(header, 26) + u16(header, 28);
  const data = await src.read(start, entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateSync(data, { out: new Uint8Array(entry.size) });
  throw new ZipError('unsupported_compression');
}
