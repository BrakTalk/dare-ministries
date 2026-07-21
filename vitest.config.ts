import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Never pick up copies of tests inside the Eleventy build output.
    exclude: [...configDefaults.exclude, '_site/**'],
  },
});
