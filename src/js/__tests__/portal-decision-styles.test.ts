import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalCss = readFileSync(resolve(import.meta.dirname, '../../css/portal.css'), 'utf8');

describe('portal account decision styles', () => {
  it('keeps account-review textarea text clear of the border', () => {
    expect(portalCss).toMatch(/\.portal-decision textarea\s*\{[^}]*padding:\s*0\.75rem 0\.85rem;/s);
  });
});
