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
        emptyOutDir: true,
        // v1.15: split the previously-500KB main bundle into focused chunks
        // so first-paint only loads the core game; monetization / RL / panels
        // are pulled in as the player reaches them. Target main ≤ 350KB.
        chunkSizeWarningLimit: 360,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('/web/src/')) return undefined;
                    // Spawn helpers are shared between core gameplay (main),
                    // RL training (rl chunk) and the spawn panel (meta);
                    // pin them to main so rollup doesn't accidentally
                    // create a meta↔rl cycle through them.
                    if (
                        id.includes('/web/src/bot/blockSpawn') ||
                        id.includes('/web/src/bot/blockPool') ||
                        id.includes('/web/src/bot/spawnLayers')
                    ) {
                        return undefined;
                    }
                    // RL bot training surface — only loaded when the user
                    // explicitly opens the bot panel.
                    if (id.includes('/web/src/bot/')) return 'rl';
                    // Player-facing meta (monetization + meta progression).
                    // Grouped together because the insight/replay panels
                    // share commercialInsight + skills, which would
                    // otherwise create a circular split.
                    if (
                        id.includes('/web/src/monetization/') ||
                        id.includes('/web/src/checkin/') ||
                        id.includes('/web/src/rewards/') ||
                        id.includes('/web/src/onboarding/') ||
                        id.includes('/web/src/skills/') ||
                        id.includes('/web/src/seasonalSkin') ||
                        id.includes('/web/src/playerInsightPanel') ||
                        id.includes('/web/src/spawnModelPanel') ||
                        id.includes('/web/src/replay') ||
                        id.includes('/web/src/personalDashboard') ||
                        id.includes('/web/src/levelEditorPanel')
                    ) {
                        return 'meta';
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
            // 文档 API（/docs/list、/docs/raw/*）→ Flask 后端
            '/docs/list': { target: apiOrigin, changeOrigin: true },
            '/docs/raw':  { target: apiOrigin, changeOrigin: true },
            // 其余 /api/* 也透传（保持与原有行为一致）
            '/api':       { target: apiOrigin, changeOrigin: true },
        }
    }
};
