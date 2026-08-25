import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styleCss = readFileSync(resolve(import.meta.dirname, '../../css/style.css'), 'utf8');
const rosterCss = readFileSync(resolve(import.meta.dirname, '../../css/roster.css'), 'utf8');

describe('shared gallery style tokens', () => {
  it('defines the shared overlay values once in the global stylesheet', () => {
    expect(styleCss).toMatch(/--color-gallery-backdrop:\s*rgba\(7, 18, 31, 0\.9\);/);
    expect(styleCss).toMatch(/--color-gallery-control:\s*rgba\(7, 18, 31, 0\.78\);/);
    expect(styleCss).toMatch(/--color-gallery-surface:\s*rgba\(7, 18, 31, 0\.82\);/);
    expect(styleCss).toMatch(/--space-gallery-frame-gap:\s*0\.65rem;/);
    expect(styleCss).toMatch(/--size-gallery-page-control:\s*3rem;/);
  });

  it.each([
    ['public Field Note gallery', styleCss],
    ['roster photo preview', rosterCss],
  ])('uses the shared tokens in the %s', (_name, css) => {
    expect(css).toContain('background: var(--color-gallery-backdrop);');
    expect(css).toContain('background: var(--color-gallery-control);');
    expect(css).toContain('background: var(--color-gallery-surface);');
    expect(css).toContain('gap: var(--space-gallery-frame-gap);');
    expect(css).toContain('width: var(--size-gallery-page-control);');
  });
});
