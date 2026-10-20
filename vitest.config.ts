import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          exclude: ['tests/unit/renderer/**'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'unit:renderer',
          include: ['tests/unit/renderer/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['tests/support/renderer-setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'perf',
          include: ['tests/perf/**/*.perf.test.ts'],
          environment: 'node',
          pool: 'forks',
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'arch',
          include: ['tests/arch/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
