/**
 * 端口与 API 地址统一从根目录 .env / .env.local 读取；也可用 `VITE_PORT=80 npm run dev` 覆盖。
 * @type {import('vite').UserConfig}
 */
import { resolveApiOrigin } from './scripts/resolve-api-origin.mjs';
import { resolveVitePort } from './scripts/resolve-vite-port.mjs';

const devPort = resolveVitePort();
const apiOrigin = resolveApiOrigin();

export default {
    root: 'web',
    base: './',
    envDir: '..',
    define: {
        'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiOrigin),
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true
    },
    preview: {
        host: true,
        port: devPort,
        strictPort: true,
    },
    server: {
        /**
         * 端口：`VITE_PORT`（默认 3000）。常用脚本：`npm run dev:3000`、`npm run dev:80`；
         * 监听 80 等 <1024 端口需 root：`npm run dev:sudo`。
         */
        host: true,
        port: devPort,
        strictPort: true,
        open: true,
        proxy: {
            // 文档 API（/docs/list、/docs/raw/*）→ Flask 后端
            '/docs/list': { target: apiOrigin, changeOrigin: true },
            '/docs/raw':  { target: apiOrigin, changeOrigin: true },
            // 其余 /api/* 也透传（保持与原有行为一致）
            '/api':       { target: apiOrigin, changeOrigin: true },
        }
    }
};
