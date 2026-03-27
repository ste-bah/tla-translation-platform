import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@tla/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@tla/registry': resolve(__dirname, '../registry/src/index.ts'),
      '@tla/ingestion': resolve(__dirname, '../ingestion/src/index.ts'),
      '@tla/translator': resolve(__dirname, '../translator/src/index.ts'),
      '@tla/validator': resolve(__dirname, '../validator/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 2 },
    },
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: {
        branches: 60,
        functions: 60,
        lines: 60,
        statements: 60,
      },
    },
  },
});
