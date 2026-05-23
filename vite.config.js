/**
 * 端口与 API 地址统一从根目录 .env / .env.local 读取；也可用 `VITE_PORT=80 npm run dev` 覆盖。
 * @type {import('vite').UserConfig}
 */
import { resolveApiOrigin } from './scripts/resolve-api-origin.mjs';
import { resolveVitePort } from './scripts/resolve-vite-port.mjs';
import legacy from '@vitejs/plugin-legacy';

const devPort = resolveVitePort();
const apiOrigin = resolveApiOrigin();

export default {
    root: 'web',
    base: './',
    envDir: '..',
    define: {
        'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiOrigin),
    },
    plugins: [
        // Android 低版本/旧 WebView 可能不支持 ESM 或部分新语法，
        // legacy 插件会自动注入 nomodule 回退包，避免“游戏脚本未加载”。
        legacy({
            targets: ['Android >= 5', 'ChromeAndroid >= 60', 'iOS >= 12', 'Safari >= 12'],
            modernPolyfills: true,
        }),
    ],
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        // v1.62: meta / RL / panel modules have real shared dependencies
        // (wallet, commercialInsight, lifecycle, spawn diagnostics). Keeping
        // them in one async "experience" chunk avoids Rollup's rl↔meta
        // circular chunk warning while preserving a small first-play bundle.
        chunkSizeWarningLimit: 1100,
        rollupOptions: {
            input: {
                main: 'web/index.html',
                spawnEval: 'web/spawn-eval.html',
            },
            onwarn(warning, warn) {
                /* Rollup correctly reports that several modules are both dynamically
                 * and statically imported. In this app those modules are intentionally
                 * shared by the core game and deferred panels, so they cannot move into
                 * a separate async chunk; keeping them shared is the desired outcome. */
                if (
                    warning.code === 'DYNAMIC_IMPORT_WILL_NOT_MOVE_MODULE'
                    || String(warning.message || '').includes('is dynamically imported by')
                ) {
                    return;
                }
                warn(warning);
            },
            output: {
                manualChunks(id) {
                    if (!id.includes('/web/src/')) return undefined;
                    // Spawn helpers are shared between core gameplay (main),
                    // RL training and the spawn panel;
                    // pin them to main so rollup doesn't accidentally
                    // create an experience↔main cycle through them.
                    if (
                        id.includes('/web/src/bot/blockSpawn') ||
                        id.includes('/web/src/bot/blockPool') ||
                        id.includes('/web/src/bot/spawnLayers') ||
                        id.includes('/web/src/bot/simulator')
                    ) {
                        return undefined;
                    }
                    // Player-facing deferred experience modules. Keep the RL panel,
                    // monetization, skills, progression and diagnostic panels together:
                    // they share wallet / lifecycle / commercial insight dependencies.
                    if (
                        id.includes('/web/src/bot/') ||
                        id.includes('/web/src/monetization/') ||
                        id.includes('/web/src/checkin/') ||
                        id.includes('/web/src/rewards/') ||
                        id.includes('/web/src/onboarding/') ||
                        id.includes('/web/src/progression/') ||
                        id.includes('/web/src/skills/') ||
                        id.includes('/web/src/seasonalSkin') ||
                        id.includes('/web/src/playerInsightPanel') ||
                        id.includes('/web/src/spawnModelPanel') ||
                        id.includes('/web/src/replay') ||
                        id.includes('/web/src/personalDashboard') ||
                        id.includes('/web/src/levelEditorPanel') ||
                        id.includes('/web/src/decisionFlowViz') ||
                        id.includes('/web/src/algorithmDynamicsCard') ||
                        id.includes('/web/src/seasonPass')
                    ) {
                        return 'experience';
                    }
                    return undefined;
                },
            },
        },
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
            // 文档 API（/docs/list、/docs/raw/*、/docs/asset/*）→ Flask 后端
            // 注意：/docs/asset/* 必须代理，否则 markdown 内嵌图片在 vite dev
            //   下会被 SPA fallback 吃掉，浏览器把 HTML 当 image 解析 → 破图
            '/docs/list':  { target: apiOrigin, changeOrigin: true },
            '/docs/raw':   { target: apiOrigin, changeOrigin: true },
            '/docs/asset': { target: apiOrigin, changeOrigin: true },
            '/api':        { target: apiOrigin, changeOrigin: true },
        }
    }
};
