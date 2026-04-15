import { defineConfig } from 'vitest/config';
import { resolveApiOrigin } from './scripts/resolve-api-origin.mjs';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true
  },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(resolveApiOrigin()),
    'import.meta.env.VITE_SYNC_BACKEND': JSON.stringify('false')
  }
});
