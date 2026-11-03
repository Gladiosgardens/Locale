import fs from 'node:fs';
import path from 'node:path';
import { JpegError, sanitizeJpeg } from '../../supabase/functions/_shared/jpeg';

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
const includes = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));

describe('sanitizeJpeg', () => {
  it('removes EXIF/GPS, XMP and comments, keeps the ICC profile', () => {
    const input = fixture('with-gps.jpg');
    // Sanity-check the fixture really carries the metadata.
    for (const marker of ['Exif\0\0', 'PhoneMaker', 'xmpmeta', 'GPSLatitude', 'secret comment']) {
      expect(includes(input, marker)).toBe(true);
    }

    const { bytes, width, height } = sanitizeJpeg(input);

    for (const marker of ['Exif\0\0', 'PhoneMaker', 'xmpmeta', 'GPSLatitude', 'secret comment']) {
      expect(includes(bytes, marker)).toBe(false);
    }
    expect(includes(bytes, 'ICC_PROFILE')).toBe(true);
    expect([width, height]).toEqual([96, 64]);
    expect(bytes.subarray(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));
    expect(bytes.subarray(-2)).toEqual(new Uint8Array([0xff, 0xd9]));
    expect(bytes.length).toBeLessThan(input.length);
  });

  it('handles progressive JPEGs with restart markers', () => {
    const { bytes, width, height } = sanitizeJpeg(fixture('progressive-restart.jpg'));
    expect(includes(bytes, 'PhoneMaker')).toBe(false);
    expect([width, height]).toEqual([96, 64]);
  });

  it('drops data appended after the end of the image', () => {
    const input = fixture('appended-zip.jpg');
    const { bytes } = sanitizeJpeg(input);
    expect(includes(bytes, 'hidden-zip-payload')).toBe(false);
    expect(bytes.subarray(-2)).toEqual(new Uint8Array([0xff, 0xd9]));
  });

  it('is idempotent', () => {
    const once = sanitizeJpeg(fixture('with-gps.jpg')).bytes;
    expect(sanitizeJpeg(once).bytes).toEqual(once);
  });

  it('rejects non-JPEG, truncated and oversized input', () => {
    expect(() => sanitizeJpeg(new TextEncoder().encode('\x89PNG\r\n\x1a\n....'))).toThrow(JpegError);
    const full = fixture('with-gps.jpg');
    expect(() => sanitizeJpeg(full.subarray(0, 400))).toThrow('truncated');
    expect(() => sanitizeJpeg(full, 1000)).toThrow('too_large');
  });
});
