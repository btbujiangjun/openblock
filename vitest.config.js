import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true
  },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://localhost:5000'),
    'import.meta.env.VITE_SYNC_BACKEND': JSON.stringify('false')
  }
});
