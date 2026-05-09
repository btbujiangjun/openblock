import { defineConfig } from 'vitest/config';
import { resolveApiOrigin } from './scripts/resolve-api-origin.mjs';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true
  },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(resolveApiOrigin()),
    'import.meta.env.VITE_SYNC_BACKEND': JSON.stringify('false'),
    // 避免单测默认视为 SQLite 客户端而向真实后端发起 checkin-bundle 请求
    'import.meta.env.VITE_USE_SQLITE_DB': JSON.stringify('false')
  }
});
