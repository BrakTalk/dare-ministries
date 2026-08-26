import { createHash } from 'node:crypto';
import exifr from 'exifr';
import sharp from 'sharp';
import { decodeHeic, heicIntakeEnabled } from './heic-decoder.mjs';

export const INBOX_IMAGE_CONTENT_TYPE = 'image/jpeg';
export const MAX_INBOX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_INBOX_IMAGE_PIXELS = 40_000_000;

const SUPPORTED_INPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);
const MIME_TYPES_BY_FORMAT = new Map([
  ['jpeg', new Set(['image/jpeg'])],
  ['png', new Set(['image/png'])],
  ['webp', new Set(['image/webp'])],
  ['avif', new Set(['image/avif'])],
  ['heic', new Set(['image/heic', 'image/heif'])],
  ['heif', new Set(['image/heic', 'image/heif'])],
]);
const HEIF_STILL_BRANDS = new Set(['heic', 'heix']);
const HEIF_GENERIC_BRANDS = new Set(['mif1', 'mif2', 'mif3', 'miaf', '1pic']);
const HEIF_SEQUENCE_BRANDS = new Set(['hevc', 'hevx', 'hevm', 'hevs', 'msf1', 'avis']);
const HEIF_LAYERED_BRANDS = new Set(['heim', 'heis', 'hevm', 'hevs']);

function validCalendarParts(year, month, day, hour, minute, second) {
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day &&
    value.getUTCHours() === hour &&
    value.getUTCMinutes() === minute &&
    value.getUTCSeconds() === second
  );
}

export function parseExifDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (!validCalendarParts(...parts)) return null;
  const [year, month, day, hour, minute, second] = parts;
  const capturedDate = `${yearText}-${monthText}-${dayText}`;
  return {
    capturedDate,
    capturedAtLocal: `${capturedDate}T${hourText}:${minuteText}:${secondText}`,
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

export function parseExifOffset(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return match[1] === '-' ? -total : total;
}

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return Number(number.toFixed(6));
}

export function coordinateGroupLabel(latitude, longitude) {
  const lat = finiteCoordinate(latitude, -90, 90);
  const lon = finiteCoordinate(longitude, -180, 180);
  if (lat === null || lon === null) return null;
  return `Near ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}

export function normalizeExifMetadata(tags = {}, gps = null) {
  const date = parseExifDate(tags.DateTimeOriginal) || parseExifDate(tags.DateTimeDigitized);
  const offset = parseExifOffset(tags.OffsetTimeOriginal) ?? parseExifOffset(tags.OffsetTime);
  const latitude = finiteCoordinate(gps?.latitude, -90, 90);
  const longitude = finiteCoordinate(gps?.longitude, -180, 180);
  const hasGps = latitude !== null && longitude !== null;

  return {
    capturedAtLocal: date?.capturedAtLocal || null,
    capturedDate: date?.capturedDate || null,
    capturedOffsetMinutes: date ? offset : null,
    gpsLatitude: hasGps ? latitude : null,
    gpsLongitude: hasGps ? longitude : null,
    locationGroup: hasGps ? coordinateGroupLabel(latitude, longitude) : null,
    source: date || hasGps ? 'exif' : null,
    exifSubset: {
      ...(date ? { captured_at_local: date.capturedAtLocal } : {}),
      ...(date && offset !== null ? { captured_offset_minutes: offset } : {}),
      ...(hasGps ? { gps_latitude: latitude, gps_longitude: longitude } : {}),
    },
  };
}

async function extractExif(buffer) {
  const [tagResult, gpsResult] = await Promise.allSettled([
    exifr.parse(buffer, {
      pick: [
        'DateTimeOriginal',
        'DateTimeDigitized',
        'OffsetTimeOriginal',
        'OffsetTime',
        'Orientation',
      ],
      translateKeys: true,
      translateValues: false,
      reviveValues: false,
      mergeOutput: true,
      sanitize: true,
    }),
    exifr.gps(buffer),
  ]);

  const tags = tagResult.status === 'fulfilled' && tagResult.value ? tagResult.value : {};
  const normalized = normalizeExifMetadata(
    tags,
    gpsResult.status === 'fulfilled' ? gpsResult.value : null
  );
  const orientation = Number(tags.Orientation);
  const sourceOrientation =
    Number.isInteger(orientation) && orientation >= 1 && orientation <= 8 ? orientation : null;
  return {
    ...normalized,
    sourceOrientation,
    exifSubset: {
      ...normalized.exifSubset,
      ...(sourceOrientation ? { source_orientation: sourceOrientation } : {}),
    },
  };
}

function fourCharacterCode(buffer, offset) {
  return buffer.toString('ascii', offset, offset + 4);
}

function inspectIsoBaseMedia(buffer) {
  if (buffer.length < 16 || fourCharacterCode(buffer, 4) !== 'ftyp') return null;
  const boxSize = buffer.readUInt32BE(0);
  if (boxSize < 16 || boxSize > buffer.length || (boxSize - 16) % 4 !== 0) return null;
  const brands = new Set([fourCharacterCode(buffer, 8)]);
  for (let offset = 16; offset < boxSize; offset += 4) {
    brands.add(fourCharacterCode(buffer, offset));
  }
  return brands;
}

function intersects(brands, candidates) {
  return [...candidates].some((brand) => brands.has(brand));
}

export function detectFieldPhotoFormat(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    fourCharacterCode(buffer, 0) === 'RIFF' &&
    fourCharacterCode(buffer, 8) === 'WEBP'
  ) {
    return 'webp';
  }

  const brands = inspectIsoBaseMedia(buffer);
  if (!brands) return null;
  if (intersects(brands, HEIF_LAYERED_BRANDS)) return 'heif-layered';
  if (intersects(brands, HEIF_SEQUENCE_BRANDS)) return 'heif-sequence';
  if (brands.has('avif')) return 'avif';
  if (intersects(brands, HEIF_STILL_BRANDS)) return 'heic';
  if (intersects(brands, HEIF_GENERIC_BRANDS)) return 'heif';
  return null;
}

function assertDeclaredTypeMatches(format, declaredType) {
  if (!declaredType) return;
  if (!MIME_TYPES_BY_FORMAT.get(format)?.has(declaredType)) {
    throw new Error('The attachment contents do not match its declared photo type.');
  }
}

export async function processFieldPhoto(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!buffer.length) throw new Error('The image is empty.');
  if (buffer.length > MAX_INBOX_IMAGE_BYTES) {
    throw new Error('The image is larger than the 15 MB intake limit.');
  }

  const format = detectFieldPhotoFormat(buffer);
  if (format === 'heif-sequence') {
    throw new Error('Timed HEIF sequences and videos are not supported.');
  }
  if (format === 'heif-layered') {
    throw new Error('Layered HEIF formats are not supported.');
  }
  if (!format || (!SUPPORTED_INPUT_FORMATS.has(format) && format !== 'heic' && format !== 'heif')) {
    throw new Error('Only JPEG, PNG, WebP, AVIF, HEIC, and HEIF photos are supported.');
  }
  const declaredType = String(options.declaredType || '')
    .trim()
    .toLowerCase();
  assertDeclaredTypeMatches(format, declaredType);

  let image;
  let metadata;
  let exifSource = buffer;
  let autoOrient = true;
  if (format === 'heic' || format === 'heif') {
    if (!heicIntakeEnabled(options.heicEnabled)) {
      throw new Error('HEIC photo intake is not enabled.');
    }
    const decoded = await decodeHeic(buffer, options.decoderOptions);
    image = sharp(decoded.pixels, {
      raw: { width: decoded.width, height: decoded.height, channels: decoded.channels },
      failOn: 'warning',
      limitInputPixels: MAX_INBOX_IMAGE_PIXELS,
    });
    metadata = { format, width: decoded.width, height: decoded.height, pages: 1 };
    exifSource = decoded.exif;
    autoOrient = false;
  } else {
    image = sharp(buffer, {
      animated: false,
      failOn: 'warning',
      limitInputPixels: MAX_INBOX_IMAGE_PIXELS,
    });
    metadata = await image.metadata();
    const decodedFormatMatches =
      metadata.format === format || (format === 'avif' && metadata.format === 'heif');
    if (!decodedFormatMatches) {
      throw new Error('The attachment signature does not match the decoded photo format.');
    }
  }
  if (!metadata.width || !metadata.height)
    throw new Error('The image dimensions could not be read.');
  if (metadata.pages && metadata.pages > 1)
    throw new Error('Animated or multi-page images are not supported.');
  if (metadata.width * metadata.height > MAX_INBOX_IMAGE_PIXELS) {
    throw new Error('The image dimensions are too large to process safely.');
  }

  const exif = await extractExif(exifSource);
  const orientedImage = autoOrient ? image.rotate() : image;
  const rendered = await orientedImage
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, progressive: true })
    .toBuffer({ resolveWithObject: true });
  const thumbnail = await sharp(rendered.data)
    .resize({ width: 480, height: 360, fit: 'cover', position: 'attention' })
    .jpeg({ quality: 78, progressive: true })
    .toBuffer();

  return {
    image: rendered.data,
    thumbnail,
    contentType: INBOX_IMAGE_CONTENT_TYPE,
    byteSize: rendered.data.byteLength,
    width: rendered.info.width,
    height: rendered.info.height,
    sha256: createHash('sha256').update(rendered.data).digest('hex'),
    ...exif,
  };
}
