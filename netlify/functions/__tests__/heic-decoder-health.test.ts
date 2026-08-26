import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDeployPreviewRequest } from '../heic-decoder-health.mjs';

describe('HEIC decoder deploy-preview health guard', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts the Netlify deploy-preview runtime context', () => {
    vi.stubEnv('CONTEXT', 'deploy-preview');

    expect(
      isDeployPreviewRequest(new Request('https://example.com/api/internal/heic-decoder-health'))
    ).toBe(true);
  });

  it('accepts a Netlify PR deploy-preview hostname when CONTEXT is unavailable', () => {
    vi.stubEnv('CONTEXT', '');

    expect(
      isDeployPreviewRequest(
        new Request(
          'https://deploy-preview-17--dare-ministries.netlify.app/api/internal/heic-decoder-health'
        )
      )
    ).toBe(true);
  });

  it.each([
    'https://dare-ministries.netlify.app/api/internal/heic-decoder-health',
    'https://deploy-preview-17--dare-ministries.example.com/api/internal/heic-decoder-health',
    'https://deploy-preview-attacker--dare-ministries.netlify.app/api/internal/heic-decoder-health',
  ])('rejects a non-preview URL: %s', (url) => {
    vi.stubEnv('CONTEXT', 'production');

    expect(isDeployPreviewRequest(new Request(url))).toBe(false);
  });

  it('rejects a malformed request URL', () => {
    vi.stubEnv('CONTEXT', 'production');

    expect(isDeployPreviewRequest({ url: 'not a URL' })).toBe(false);
  });
});
