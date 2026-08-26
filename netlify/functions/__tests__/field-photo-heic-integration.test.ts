import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { processFieldPhoto } from '../lib/field-photo-processing.mjs';

const fixtureDirectory = resolve(process.cwd(), 'netlify/functions/__tests__/fixtures/heic');
const nativeTests = describe.runIf(process.platform === 'linux' && process.arch === 'x64');

nativeTests('HEIC Field Photo Inbox integration', () => {
  it('extracts original HEIC date/timezone/GPS and emits metadata-free JPEG derivatives', async () => {
    const source = await readFile(resolve(fixtureDirectory, 'iphone-standard-exif-gps.heic'));
    const processed = await processFieldPhoto(source, {
      declaredType: 'image/heic',
      heicEnabled: true,
    });
    const [image, thumbnail] = await Promise.all([
      sharp(processed.image).metadata(),
      sharp(processed.thumbnail).metadata(),
    ]);

    expect(processed).toMatchObject({
      contentType: 'image/jpeg',
      capturedAtLocal: '2026-08-25T14:32:10',
      capturedOffsetMinutes: -240,
      capturedDate: '2026-08-25',
      gpsLatitude: 35.595123,
      gpsLongitude: -82.551568,
    });
    expect(image).toMatchObject({ format: 'jpeg', width: 160, height: 120 });
    expect(image.exif).toBeUndefined();
    expect(image.icc).toBeUndefined();
    expect(thumbnail).toMatchObject({ format: 'jpeg', width: 480, height: 360 });
    expect(thumbnail.exif).toBeUndefined();
  });

  it.each([
    ['iphone-public-demo.heic', 1440, 960],
    ['rotated-mirrored.heic', 120, 160],
    ['portrait-auxiliary.heic', 512, 512],
    ['hdr-10bit.heic', 192, 108],
    ['no-exif.heic', 160, 120],
  ])('selects and sanitizes the primary still in %s', async (name, width, height) => {
    const processed = await processFieldPhoto(await readFile(resolve(fixtureDirectory, name)), {
      declaredType: 'image/heic',
      heicEnabled: true,
    });

    expect(processed).toMatchObject({ width, height, contentType: 'image/jpeg' });
    expect((await sharp(processed.image).metadata()).exif).toBeUndefined();
  });
});
