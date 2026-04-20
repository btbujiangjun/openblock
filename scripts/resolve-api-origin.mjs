/**
 * 与 server.py 约定一致：优先 OPENBLOCK_API_ORIGIN，其次 VITE_API_BASE_URL，默认 http://0.0.0.0:5000。
 * 供 vite / vitest 在构建时注入 import.meta.env.VITE_API_BASE_URL。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseEnvFile(filePath) {
    const out = {};
    if (!fs.existsSync(filePath)) {
        return out;
    }
    let text;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch {
        return out;
    }
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) {
            continue;
        }
        const eq = t.indexOf('=');
        if (eq <= 0) {
            continue;
        }
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if (
            (v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))
        ) {
            v = v.slice(1, -1);
        }
        out[k] = v;
    }
    return out;
}

/** 合并仓库根目录 `.env` 与 `.env.local`（后者覆盖前者）；供 Vite 端口等 Node 侧解析复用。 */
export function loadRootEnv() {
    const base = path.join(ROOT, '.env');
    const local = path.join(ROOT, '.env.local');
    return { ...parseEnvFile(base), ...parseEnvFile(local) };
}

/**
 * @returns {string} API 根 URL，无末尾斜杠
 */
export function resolveApiOrigin() {
    const merged = loadRootEnv();
    const explicit =
        merged.OPENBLOCK_API_ORIGIN ||
        merged.VITE_API_BASE_URL ||
        process.env.OPENBLOCK_API_ORIGIN ||
        process.env.VITE_API_BASE_URL;
    if (explicit) {
        return String(explicit).replace(/\/+$/, '');
    }
    const host = merged.API_HOST || process.env.API_HOST || '127.0.0.1';
    const port = merged.PORT || process.env.PORT || '5000';
    return `http://${host}:${port}`;
}
