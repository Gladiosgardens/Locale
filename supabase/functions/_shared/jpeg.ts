// Byte-level JPEG sanitiser. Pure TypeScript (no Deno or Node APIs) so it can
// run in the Edge Function and be unit-tested with Jest.
//
// It rewrites a JPEG keeping only what is needed to decode the image:
//   - drops APP1-APP15 (EXIF incl. GPS, XMP, IPTC, maker notes...) except an
//     ICC colour profile in APP2, and drops COM comments;
//   - keeps APP0 (JFIF) and all coding segments (DQT, DHT, SOF, SOS, DRI...);
//   - drops anything after the end-of-image marker (appended files).
// It also reports the pixel size from the frame header.

export class JpegError extends Error {}

export type SanitizedJpeg = { bytes: Uint8Array; width: number; height: number };

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;
const APP0 = 0xe0;
const APP2 = 0xe2;
const ICC_ID = 'ICC_PROFILE\0';

function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function isStandalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

function startsWithAscii(data: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (data[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function keepSegment(marker: number, data: Uint8Array, payloadStart: number): boolean {
  if (marker === COM) return false;
  if (marker === APP0) return true;
  if (marker === APP2) return startsWithAscii(data, payloadStart, ICC_ID);
  if (marker > APP0 && marker <= 0xef) return false;
  return true;
}

export function sanitizeJpeg(input: Uint8Array, maxBytes = 10 * 1024 * 1024): SanitizedJpeg {
  if (input.length > maxBytes) throw new JpegError('too_large');
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI) throw new JpegError('not_jpeg');

  const out: Uint8Array[] = [new Uint8Array([0xff, SOI])];
  let width = 0;
  let height = 0;
  let sawScan = false;
  let pos = 2;

  const readMarker = (): number => {
    if (input[pos] !== 0xff) throw new JpegError('corrupt');
    while (input[pos] === 0xff) pos++; // fill bytes
    if (pos >= input.length) throw new JpegError('truncated');
    return input[pos++];
  };

  while (true) {
    if (pos >= input.length) throw new JpegError('truncated');
    const marker = readMarker();

    if (marker === EOI) {
      if (!sawScan) throw new JpegError('no_image_data');
      out.push(new Uint8Array([0xff, EOI]));
      break;
    }
    if (isStandalone(marker)) {
      out.push(new Uint8Array([0xff, marker]));
      continue;
    }
    if (pos + 2 > input.length) throw new JpegError('truncated');
    const length = (input[pos] << 8) | input[pos + 1];
    if (length < 2 || pos + length > input.length) throw new JpegError('truncated');
    const segmentEnd = pos + length;

    if (isSof(marker)) {
      if (length < 8) throw new JpegError('corrupt');
      height = (input[pos + 3] << 8) | input[pos + 4];
      width = (input[pos + 5] << 8) | input[pos + 6];
    }

    if (keepSegment(marker, input, pos + 2)) {
      out.push(new Uint8Array([0xff, marker]), input.subarray(pos, segmentEnd));
    }
    pos = segmentEnd;

    if (marker === SOS) {
      if (!width || !height) throw new JpegError('no_frame_header');
      sawScan = true;
      // Copy entropy-coded data up to the next real marker. Inside scan data
      // 0xFF is followed by 0x00 (stuffing) or a restart marker 0xD0-0xD7.
      const scanStart = pos;
      while (pos < input.length) {
        if (input[pos] === 0xff) {
          const next = input[pos + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            pos += 2;
            continue;
          }
          if (next === 0xff) {
            pos += 1;
            continue;
          }
          break;
        }
        pos++;
      }
      if (pos >= input.length) throw new JpegError('truncated');
      out.push(input.subarray(scanStart, pos));
    }
  }

  if (!width || !height) throw new JpegError('no_frame_header');

  const total = out.reduce((n, part) => n + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of out) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { bytes, width, height };
}
