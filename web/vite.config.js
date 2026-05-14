/**
 * web/ 子目录专用 Vite 配置（当从 web/ 目录直接执行 npx vite 时生效）。
 * 与根目录 vite.config.js 保持代理规则一致，避免 /docs/list 等 API 请求拿到 HTML 404。
 */
import { resolveApiOrigin } from '../scripts/resolve-api-origin.mjs';
import { resolveVitePort } from '../scripts/resolve-vite-port.mjs';

const devPort = resolveVitePort();
const apiOrigin = resolveApiOrigin();

export default {
    base: './',
    envDir: '..',
    server: {
        host: true,
        port: devPort,
        strictPort: true,
        open: true,
        proxy: {
            '/docs/list':  { target: apiOrigin, changeOrigin: true },
            '/docs/raw':   { target: apiOrigin, changeOrigin: true },
            '/docs/asset': { target: apiOrigin, changeOrigin: true },
            '/api':        { target: apiOrigin, changeOrigin: true },
        },
    },
};
