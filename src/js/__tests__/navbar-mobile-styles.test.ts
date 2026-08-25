import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styleCss = readFileSync(resolve(import.meta.dirname, '../../css/style.css'), 'utf8');

describe('mobile navigation styles', () => {
  it('sizes each padded link as a real menu row so action buttons cannot overlap', () => {
    expect(styleCss).toMatch(/--space-nav-mobile-link-block:\s*12px;/);
    expect(styleCss).toMatch(/--space-nav-mobile-link-inline:\s*16px;/);
    expect(styleCss).toMatch(
      /@media \(max-width: 768px\)[\s\S]*?\.nav-links li\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*center;[^}]*width:\s*100%;[^}]*\}[\s\S]*?\.nav-links a\s*\{[^}]*display:\s*block;[^}]*box-sizing:\s*border-box;[^}]*padding:\s*var\(--space-nav-mobile-link-block\) var\(--space-nav-mobile-link-inline\);[^}]*width:\s*auto;[^}]*\}/
    );
  });
});
