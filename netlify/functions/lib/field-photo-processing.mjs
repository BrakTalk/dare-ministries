import { createHash } from 'node:crypto';
import exifr from 'exifr';
import sharp from 'sharp';

export const INBOX_IMAGE_CONTENT_TYPE = 'image/jpeg';
export const MAX_INBOX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_INBOX_IMAGE_PIXELS = 40_000_000;

const SUPPORTED_INPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);

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
      pick: ['DateTimeOriginal', 'DateTimeDigitized', 'OffsetTimeOriginal', 'OffsetTime'],
      translateKeys: true,
      translateValues: false,
      reviveValues: false,
      mergeOutput: true,
      sanitize: true,
    }),
    exifr.gps(buffer),
  ]);

  return normalizeExifMetadata(
    tagResult.status === 'fulfilled' && tagResult.value ? tagResult.value : {},
    gpsResult.status === 'fulfilled' ? gpsResult.value : null
  );
}

export async function processFieldPhoto(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!buffer.length) throw new Error('The image is empty.');
  if (buffer.length > MAX_INBOX_IMAGE_BYTES) {
    throw new Error('The image is larger than the 15 MB intake limit.');
  }

  const image = sharp(buffer, {
    animated: false,
    failOn: 'warning',
    limitInputPixels: MAX_INBOX_IMAGE_PIXELS,
  });
  const metadata = await image.metadata();
  if (!SUPPORTED_INPUT_FORMATS.has(metadata.format)) {
    throw new Error('Only JPEG, PNG, WebP, and AVIF photos are supported.');
  }
  if (!metadata.width || !metadata.height)
    throw new Error('The image dimensions could not be read.');
  if (metadata.pages && metadata.pages > 1)
    throw new Error('Animated or multi-page images are not supported.');
  if (metadata.width * metadata.height > MAX_INBOX_IMAGE_PIXELS) {
    throw new Error('The image dimensions are too large to process safely.');
  }

  const exif = await extractExif(buffer);
  const rendered = await image
    .rotate()
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
