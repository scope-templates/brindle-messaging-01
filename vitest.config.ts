import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'clients/node/test/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
