import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Never pick up copies of tests inside the Eleventy build output.
    exclude: ['**/node_modules/**', '_site/**'],
  },
});
