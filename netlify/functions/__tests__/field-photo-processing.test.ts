import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const state = vi.hoisted(() => ({
  decodeHeic: vi.fn(),
}));

vi.mock('../lib/heic-decoder.mjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/heic-decoder.mjs')>()),
  decodeHeic: (...args: unknown[]) => state.decodeHeic(...args),
}));

import {
  coordinateGroupLabel,
  detectFieldPhotoFormat,
  normalizeExifMetadata,
  parseExifDate,
  parseExifOffset,
  processFieldPhoto,
} from '../lib/field-photo-processing.mjs';

const fixtureDirectory = resolve(process.cwd(), 'netlify/functions/__tests__/fixtures/heic');

beforeEach(() => {
  state.decodeHeic.mockReset();
});

describe('field photo EXIF normalization', () => {
  it('normalizes capture time, timezone offset, and GPS without converting local wall time', () => {
    expect(
      normalizeExifMetadata(
        {
          DateTimeOriginal: '2026:08:25 14:32:10',
          OffsetTimeOriginal: '-04:00',
        },
        { latitude: 35.5951234, longitude: -82.5515678 }
      )
    ).toEqual({
      capturedAtLocal: '2026-08-25T14:32:10',
      capturedDate: '2026-08-25',
      capturedOffsetMinutes: -240,
      gpsLatitude: 35.595123,
      gpsLongitude: -82.551568,
      locationGroup: 'Near 35.60, -82.55',
      source: 'exif',
      exifSubset: {
        captured_at_local: '2026-08-25T14:32:10',
        captured_offset_minutes: -240,
        gps_latitude: 35.595123,
        gps_longitude: -82.551568,
      },
    });
  });

  it('rejects impossible dates, offsets, and coordinates', () => {
    expect(parseExifDate('2026:02:31 10:00:00')).toBeNull();
    expect(parseExifOffset('+15:00')).toBeNull();
    expect(coordinateGroupLabel(91, -82)).toBeNull();
    expect(
      normalizeExifMetadata({ DateTimeOriginal: 'not a date' }, { latitude: 0, longitude: 0 })
    ).toMatchObject({
      capturedDate: null,
      gpsLatitude: 0,
      gpsLongitude: 0,
      source: 'exif',
    });
  });
});

describe('field photo image rewriting', () => {
  it('creates bounded JPEG derivatives and strips source metadata', async () => {
    const source = await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: '#315c76' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const processed = await processFieldPhoto(source);
    const imageMetadata = await sharp(processed.image).metadata();
    const thumbnailMetadata = await sharp(processed.thumbnail).metadata();

    expect(processed.contentType).toBe('image/jpeg');
    expect(processed.width).toBeLessThanOrEqual(2000);
    expect(processed.height).toBeLessThanOrEqual(2000);
    expect(processed.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(imageMetadata.orientation).toBeUndefined();
    expect(imageMetadata.exif).toBeUndefined();
    expect(thumbnailMetadata.width).toBe(480);
    expect(thumbnailMetadata.height).toBe(360);
  });

  it('rejects empty input before invoking the image decoder', async () => {
    await expect(processFieldPhoto(Buffer.alloc(0))).rejects.toThrow('empty');
  });

  it.each(['jpeg', 'png', 'webp', 'avif'] as const)(
    'preserves %s intake while producing metadata-free JPEGs',
    async (format) => {
      const source = await sharp({
        create: { width: 96, height: 64, channels: 3, background: '#315c76' },
      })
        .toFormat(format)
        .toBuffer();

      expect(detectFieldPhotoFormat(source)).toBe(format);
      const processed = await processFieldPhoto(source, {
        declaredType: `image/${format}`,
      });
      const metadata = await sharp(processed.image).metadata();

      expect(processed.contentType).toBe('image/jpeg');
      expect(metadata.format).toBe('jpeg');
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }
  );

  it('rejects a MIME-spoofed non-HEIC file based on its real signature', async () => {
    const png = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#315c76' },
    })
      .png()
      .toBuffer();

    await expect(
      processFieldPhoto(png, { declaredType: 'image/heic', heicEnabled: true })
    ).rejects.toThrow('do not match');
    expect(state.decodeHeic).not.toHaveBeenCalled();
  });

  it('keeps HEIC fail-closed while the rollout flag is disabled', async () => {
    const source = await readFile(resolve(fixtureDirectory, 'no-exif.heic'));

    await expect(
      processFieldPhoto(source, { declaredType: 'image/heic', heicEnabled: false })
    ).rejects.toThrow('not enabled');
    expect(state.decodeHeic).not.toHaveBeenCalled();
  });

  it('passes bounded HEIC RGB output through the existing Sharp derivative pipeline', async () => {
    const source = await readFile(resolve(fixtureDirectory, 'no-exif.heic'));
    state.decodeHeic.mockResolvedValue({
      pixels: Buffer.alloc(120 * 80 * 3, 96),
      exif: Buffer.alloc(0),
      width: 120,
      height: 80,
      channels: 3,
      auxiliaryImages: 0,
      hasDepth: false,
      decoderVersion: 'libheif 1.23.1 + libde265 1.1.1',
    });

    const processed = await processFieldPhoto(source, {
      declaredType: 'image/heic',
      heicEnabled: true,
    });
    const imageMetadata = await sharp(processed.image).metadata();

    expect(state.decodeHeic).toHaveBeenCalledWith(source, undefined);
    expect(processed).toMatchObject({ width: 120, height: 80, contentType: 'image/jpeg' });
    expect(imageMetadata.exif).toBeUndefined();
    expect(imageMetadata.icc).toBeUndefined();
  });

  it('rejects sequence brands before allocating a decoder raster', async () => {
    const sequence = await readFile(resolve(fixtureDirectory, 'timed-sequence.heic'));

    expect(detectFieldPhotoFormat(sequence)).toBe('heif-sequence');
    await expect(
      processFieldPhoto(sequence, { declaredType: 'image/heic', heicEnabled: true })
    ).rejects.toThrow('sequences and videos');
    expect(state.decodeHeic).not.toHaveBeenCalled();
  });
});
