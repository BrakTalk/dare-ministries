import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  coordinateGroupLabel,
  normalizeExifMetadata,
  parseExifDate,
  parseExifOffset,
  processFieldPhoto,
} from '../lib/field-photo-processing.mjs';

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
});
