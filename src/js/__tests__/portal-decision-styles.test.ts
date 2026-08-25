import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const portalCss = readFileSync(resolve(here, '../../css/portal.css'), 'utf8');

describe('portal account decision styles', () => {
  it('keeps account-review textarea text clear of the border', () => {
    expect(portalCss).toMatch(/\.portal-decision textarea\s*\{[^}]*padding:\s*0\.75rem 0\.85rem;/s);
  });
});
