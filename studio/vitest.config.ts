import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': `${__dirname}/src`,
      '@components': `${__dirname}/frontend/src/components`,
      '@hooks': `${__dirname}/frontend/src/hooks`,
      '@lib': `${__dirname}/frontend/src/lib`,
      '@types': `${__dirname}/frontend/src/types`,
      '@stores': `${__dirname}/frontend/src/stores`,
      '@api': `${__dirname}/frontend/src/api`,
      '@renderer': `${__dirname}/src/renderer`,
      '@service': `${__dirname}/src/service`,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.{test,spec}.ts', 'tests/unit/**/*.{test,spec}.tsx'],
    exclude: ['tests/e2e/**', '**/node_modules/**'],
  },
});
