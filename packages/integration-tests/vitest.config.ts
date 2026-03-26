import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@tla/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@tla/registry': resolve(__dirname, '../registry/src/index.ts'),
      '@tla/ingestion': resolve(__dirname, '../ingestion/src/index.ts'),
      '@tla/translator': resolve(__dirname, '../translator/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/benchmarks/**'],
    testTimeout: 30000,
  },
});
