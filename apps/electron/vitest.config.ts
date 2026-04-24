import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    globals: true,
    // Default environment is node. DOM tests opt in via a docblock pragma:
    //   // @vitest-environment jsdom
    environment: 'node',
    // DOM tests dynamically import renderer modules and hit React 19's
    // stricter act() pipeline; the default 5s timeout isn't enough when
    // the jsdom env cold-starts inside a big suite.
    testTimeout: 15000,
    include: [
      'tests/**/*.test.ts',
      'tests/unit/renderer/*.dom.test.tsx',
    ],
    exclude: ['tests/unit/_legacy/**'],
    setupFiles: ['tests/setup.ts'],
  },
});
