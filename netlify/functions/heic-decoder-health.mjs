import { readFile } from 'node:fs/promises';
import { decodeHeic } from './lib/heic-decoder.mjs';
import { json } from './lib/helpers.mjs';

export const config = {
  path: '/api/internal/heic-decoder-health',
  includedFiles: ['./vendor/heic-decoder/**', './__tests__/fixtures/heic/no-exif.heic'],
};

export default async () => {
  if (process.env.CONTEXT !== 'deploy-preview') {
    return json({ error: 'Not found.' }, 404);
  }

  try {
    const fixture = await readFile(
      new URL('./__tests__/fixtures/heic/no-exif.heic', import.meta.url)
    );
    const decoded = await decodeHeic(fixture);
    return json({
      ok: true,
      decoder: decoded.decoderVersion,
      width: decoded.width,
      height: decoded.height,
      auxiliaryImages: decoded.auxiliaryImages,
    });
  } catch {
    return json({ ok: false, error: 'Packaged HEIC decoder self-test failed.' }, 503);
  }
};
