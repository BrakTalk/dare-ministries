import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { decodeHeic } from '../lib/heic-decoder.mjs';

const fixtureDirectory = resolve(process.cwd(), 'netlify/functions/__tests__/fixtures/heic');
const nativeTests = describe.runIf(process.platform === 'linux' && process.arch === 'x64');

describe('HEIC decoder process controls', () => {
  it('enforces the attachment byte limit before creating decoder files', async () => {
    await expect(decodeHeic(Buffer.alloc(15 * 1024 * 1024 + 1))).rejects.toThrow('15 MB');
  });

  it('kills a stalled decoder and removes every temporary file', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'field-photo-heic-timeout-test-'));
    try {
      await expect(
        decodeHeic(Buffer.from('not-an-image'), {
          temporaryRoot,
          decoderPath: process.execPath,
          decoderArgsPrefix: ['--eval', 'setInterval(() => {}, 1000)'],
          timeoutMs: 50,
        })
      ).rejects.toThrow('safety timeout');
      expect(await readdir(temporaryRoot)).toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('passes only a minimal environment and strips security-limit overrides and secrets', async () => {
    const script = [
      "const fs = require('node:fs')",
      'if (process.env.LIBHEIF_SECURITY_LIMITS || process.env.RESEND_API_KEY) process.exit(9)',
      'const [, pixels, exif] = process.argv.slice(1)',
      'fs.writeFileSync(pixels, Buffer.alloc(3))',
      'fs.writeFileSync(exif, Buffer.alloc(0))',
      "process.stdout.write(JSON.stringify({ width: 1, height: 1, channels: 3, exifBytes: 0, libheif: '1.23.1', libde265: '1.1.1' }))",
    ].join(';');

    await expect(
      decodeHeic(Buffer.from('test'), {
        decoderPath: process.execPath,
        decoderArgsPrefix: ['--eval', script],
        env: {
          ...process.env,
          LIBHEIF_SECURITY_LIMITS: 'off',
          RESEND_API_KEY: 'must-not-reach-child',
        },
      })
    ).resolves.toMatchObject({ width: 1, height: 1, channels: 3 });
  });
});

nativeTests('packaged Linux HEIC decoder', () => {
  it.each([
    ['iphone-standard-exif-gps.heic', 160, 120, true, 0],
    ['iphone-public-demo.heic', 1440, 960, false, 0],
    ['no-exif.heic', 160, 120, false, 0],
    ['rotated-mirrored.heic', 120, 160, true, 0],
    ['portrait-auxiliary.heic', 512, 512, false, 1],
    ['hdr-10bit.heic', 192, 108, false, 0],
  ])('decodes the primary still in %s', async (name, width, height, hasExif, auxiliaryImages) => {
    const decoded = await decodeHeic(await readFile(resolve(fixtureDirectory, name)));

    expect(decoded).toMatchObject({
      width,
      height,
      channels: 3,
      auxiliaryImages,
      decoderVersion: 'libheif 1.23.1 + libde265 1.1.1',
    });
    expect(decoded.pixels).toHaveLength(width * height * 3);
    expect(decoded.exif.byteLength > 0).toBe(hasExif);
  });

  it('rejects corrupt, truncated, multi-image, and oversized-dimension containers', async () => {
    const source = await readFile(resolve(fixtureDirectory, 'no-exif.heic'));
    const oversized = Buffer.from(source);
    const ispeOffset = oversized.indexOf(Buffer.from('ispe'));
    expect(ispeOffset).toBeGreaterThan(0);
    oversized.writeUInt32BE(50_000, ispeOffset + 8);
    oversized.writeUInt32BE(50_000, ispeOffset + 12);

    await expect(decodeHeic(Buffer.from('not a HEIF container'))).rejects.toThrow('decoded safely');
    await expect(decodeHeic(source.subarray(0, Math.floor(source.length / 2)))).rejects.toThrow();
    await expect(
      decodeHeic(await readFile(resolve(fixtureDirectory, 'multi-image-collection.heic')))
    ).rejects.toThrow('collections and multi-image');
    await expect(decodeHeic(oversized)).rejects.toThrow('dimensions are too large');
  });
});
