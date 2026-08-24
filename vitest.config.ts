import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Integration tests bind ephemeral ports; keep them off each other's toes.
    fileParallelism: false,
    testTimeout: 10_000,
  },
});
