/**
 * Vite dev / preview 监听端口：与根目录 `.env` / `.env.local` 中 `VITE_PORT` 一致；
 * 未设置时默认 3000。命令行 `VITE_PORT=80 npm run dev` 可覆盖文件。
 */
import { loadRootEnv } from './resolve-api-origin.mjs';

const DEFAULT = 3000;

export function resolveVitePort() {
    const merged = loadRootEnv();
    const raw = String(merged.VITE_PORT || process.env.VITE_PORT || String(DEFAULT)).trim();
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
        return DEFAULT;
    }
    return n;
}
