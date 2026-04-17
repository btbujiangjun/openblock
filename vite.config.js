/**
 * 端口与 API 地址统一从根目录 .env 读取，不依赖启动脚本传参。
 * @type {import('vite').UserConfig}
 */
import { readFileSync } from 'node:fs';
import { resolveApiOrigin } from './scripts/resolve-api-origin.mjs';

/* 手动加载 .env 中 VITE_PORT（Node 侧变量，Vite 不会自动注入 process.env） */
if (!process.env.VITE_PORT) {
    try {
        const txt = readFileSync(new URL('.env', import.meta.url), 'utf-8');
        const m = txt.match(/^\s*VITE_PORT\s*=\s*(\d+)/m);
        if (m) process.env.VITE_PORT = m[1];
    } catch { /* .env 不存在时用默认值 */ }
}

const devPort = Number.parseInt(process.env.VITE_PORT || '80', 10);
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
    },
    server: {
        /**
         * 端口从 .env 的 VITE_PORT 读取（默认 80）。<1024 需 root：
         *   npm run dev:sudo
         * 也可临时覆盖：VITE_PORT=3000 npm run dev
         */
        host: true,
        port: Number.isFinite(devPort) ? devPort : 80,
        strictPort: true,
        open: true
    }
};
