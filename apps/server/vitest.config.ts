import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC нужен для emitDecoratorMetadata (DI NestJS); esbuild его не поддерживает.
const swcPlugin = swc.vite({ module: { type: 'es6' } });

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [swcPlugin],
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [swcPlugin],
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          // Тесты используют общие БД и Redis — выполняются последовательно.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          globalSetup: ['test/integration/global-setup.ts'],
        },
      },
    ],
  },
});
