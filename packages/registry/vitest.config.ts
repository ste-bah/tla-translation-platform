import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@tla/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@tla/registry': resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 2 },
    },
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
