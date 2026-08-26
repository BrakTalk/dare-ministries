import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const manifestPath = resolve(projectRoot, 'netlify/functions/vendor/heic-decoder/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

for (const artifact of manifest.artifacts) {
  const path = resolve(projectRoot, 'netlify/functions/vendor/heic-decoder', artifact.path);
  const contents = await readFile(path);
  const digest = createHash('sha256').update(contents).digest('hex');
  if (digest !== artifact.sha256) {
    throw new Error(`${artifact.path} checksum mismatch: ${digest}`);
  }
  if (artifact.elf && !contents.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error(`${artifact.path} is not an ELF binary.`);
  }
}

await access(
  resolve(projectRoot, 'netlify/functions/vendor/heic-decoder/bin/heic-intake-decoder'),
  constants.X_OK
);
console.log(`Verified ${manifest.artifacts.length} pinned HEIC decoder artifacts.`);
