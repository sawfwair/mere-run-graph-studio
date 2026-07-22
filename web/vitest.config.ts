import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'web',
  test: {
    environment: 'node',
    coverage: {
      include: [
        'src/app-mode.ts',
        'src/cloud-contract.ts',
        'src/decode.ts',
        'src/graph.ts',
        'src/model-install.ts',
        'src/models.ts',
        'src/program.ts',
        'src/run-preview.ts',
        'src/ui.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 75,
        branches: 60,
      },
    },
  },
});
