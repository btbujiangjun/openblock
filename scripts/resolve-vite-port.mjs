/**
 * Vite dev / preview 监听端口：与根目录 `.env` / `.env.local` 中 `VITE_PORT` 一致；
 * 未设置时默认 3000。命令行 `VITE_PORT` 优先于 `.env` / `.env.local`。
 */
import { loadRootEnv } from './resolve-api-origin.mjs';

const DEFAULT = 3000;

export function resolveVitePort() {
    const merged = loadRootEnv();
    const raw = String(process.env.VITE_PORT || merged.VITE_PORT || String(DEFAULT)).trim();
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
        return DEFAULT;
    }
    return n;
}
