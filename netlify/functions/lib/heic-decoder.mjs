import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HEIC_DECODER_VERSION = 'libheif 1.23.1 + libde265 1.1.1';
export const HEIC_DECODE_TIMEOUT_MS = 10_000;

const MAX_PIXELS = 40_000_000;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 4096;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const bundledDecoderDirectory = join(moduleDirectory, 'vendor', 'heic-decoder');
const sourceDecoderDirectory = join(moduleDirectory, '..', 'vendor', 'heic-decoder');
const decoderDirectory = existsSync(bundledDecoderDirectory)
  ? bundledDecoderDirectory
  : sourceDecoderDirectory;
const packagedDecoderPath = join(decoderDirectory, 'bin', 'heic-intake-decoder');

export function heicIntakeEnabled(value = process.env.FIELD_PHOTO_HEIC_ENABLED) {
  return (
    String(value || '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function safeDecoderFailure(stderr) {
  const message = stderr.trim();
  if (/collection|multi-image/i.test(message)) {
    return 'HEIF collections and multi-image sequences are not supported.';
  }
  if (/sequence|video/i.test(message)) {
    return 'Timed HEIF sequences and videos are not supported.';
  }
  if (/dimension|megapixel|security limit/i.test(message)) {
    return 'The HEIC image dimensions are too large to process safely.';
  }
  if (/HEVC support|primary HEVC/i.test(message)) {
    return 'The HEIF file does not contain a supported primary HEVC still image.';
  }
  return 'The HEIC photo could not be decoded safely.';
}

function appendBounded(current, chunk) {
  if (current.length >= MAX_PROCESS_OUTPUT_BYTES) return current;
  return `${current}${chunk}`.slice(0, MAX_PROCESS_OUTPUT_BYTES);
}

function decoderEnvironment(source = process.env) {
  return {
    PATH: source.PATH || '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C',
    LC_ALL: 'C',
  };
}

async function runDecoder({ command, args, env, timeoutMs }) {
  const child = spawn(command, args, {
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr = appendBounded(stderr, chunk);
  });

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref?.();

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  if (timedOut) {
    throw new Error('HEIC decoding exceeded the 10-second safety timeout.');
  }
  if (result.code !== 0) {
    throw new Error(safeDecoderFailure(stderr));
  }

  let descriptor;
  try {
    descriptor = JSON.parse(stdout);
  } catch {
    throw new Error('The packaged HEIC decoder returned an invalid result.');
  }
  return descriptor;
}

export async function decodeHeic(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!buffer.length || buffer.length > MAX_INPUT_BYTES) {
    throw new Error('The HEIC input is outside the 15 MB intake limit.');
  }
  const temporaryRoot = options.temporaryRoot || tmpdir();
  const workDirectory = await mkdtemp(join(temporaryRoot, 'field-photo-heic-'));
  const inputPath = join(workDirectory, 'input.heic');
  const pixelsPath = join(workDirectory, 'pixels.rgb');
  const exifPath = join(workDirectory, 'metadata.tiff');
  const decoderPath = options.decoderPath || packagedDecoderPath;
  const decoderArgsPrefix = options.decoderArgsPrefix || [];
  const timeoutMs = options.timeoutMs || HEIC_DECODE_TIMEOUT_MS;

  try {
    await writeFile(inputPath, buffer, { mode: 0o600 });
    const descriptor = await runDecoder({
      command: decoderPath,
      args: [...decoderArgsPrefix, inputPath, pixelsPath, exifPath],
      env: decoderEnvironment(options.env),
      timeoutMs,
    });

    const { width, height, channels, exifBytes, libheif, libde265 } = descriptor;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width * height > MAX_PIXELS ||
      channels !== 3 ||
      libheif !== '1.23.1' ||
      libde265 !== '1.1.1'
    ) {
      throw new Error('The packaged HEIC decoder returned unsafe image dimensions.');
    }

    const expectedPixelBytes = width * height * channels;
    const [pixelStats, exifStats] = await Promise.all([stat(pixelsPath), stat(exifPath)]);
    if (
      pixelStats.size !== expectedPixelBytes ||
      !Number.isInteger(exifBytes) ||
      exifBytes < 0 ||
      exifBytes > 1024 * 1024 ||
      exifStats.size !== exifBytes
    ) {
      throw new Error('The packaged HEIC decoder returned an invalid bounded output.');
    }

    const [pixels, exif] = await Promise.all([readFile(pixelsPath), readFile(exifPath)]);
    return {
      pixels,
      exif,
      width,
      height,
      channels,
      auxiliaryImages: Number(descriptor.auxiliaryImages) || 0,
      hasDepth: descriptor.hasDepth === true,
      decoderVersion: HEIC_DECODER_VERSION,
    };
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

export function packagedHeicDecoderPath() {
  return packagedDecoderPath;
}

export function packagedHeicDecoderDirectory() {
  return dirname(packagedDecoderPath);
}
