import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './cloud/worker.ts',
      wrangler: { configPath: './wrangler.toml' },
    }),
  ],
  test: {
    include: ['cloud/**/*.test.ts'],
    coverage: {
      include: ['cloud/account.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 75,
        branches: 60,
      },
    },
  },
});
