import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    pool: 'forks', // Prevents state bleeding across tests executing concurrently
    testTimeout: 10000,
  },
});