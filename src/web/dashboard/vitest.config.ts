import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vitest config for the dashboard (audit obs 6052e0a9). Runs React component
 * tests under happy-dom. Separate from vite.config.ts to keep the production
 * build config clean. Tailwind plugin not needed here — we're not building
 * the CSS pipeline for tests.
 *
 * Entry point: `npm test` inside src/web/dashboard/ runs `vitest run`. During
 * dev, `vitest` (no args) watches for changes.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shadow/models': new URL('../../storage/models.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
