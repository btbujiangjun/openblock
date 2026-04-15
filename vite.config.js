/**
 * 不使用 import { defineConfig } from 'vite'，以便在未正确安装依赖时，
 * 配置文件本身不触发对 vite 包的解析（仍须本地安装 vite 才能启动 dev）。
 * API 根地址与仓库根 `.env` 中 OPENBLOCK_API_ORIGIN 对齐（见 scripts/resolve-api-origin.mjs）。
 * @type {import('vite').UserConfig}
 */
import { resolveApiOrigin } from './scripts/resolve-api-origin.mjs';

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
    server: {
        /**
         * 默认 80（http://0.0.0.0/）。Unix 上绑定 <1024 需 root：
         *   npm run dev:80
         * 无特权时用环境变量改端口，例如：
         *   VITE_PORT=3000 npm run dev
         */
        port: Number.isFinite(devPort) ? devPort : 80,
        strictPort: true,
        open: true
    }
};
