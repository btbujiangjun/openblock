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

/**
 * @returns {string} API 根 URL，无末尾斜杠
 */
export function resolveApiOrigin() {
    const base = path.join(ROOT, '.env');
    const local = path.join(ROOT, '.env.local');
    const merged = { ...parseEnvFile(base), ...parseEnvFile(local) };
    const raw =
        merged.OPENBLOCK_API_ORIGIN ||
        merged.VITE_API_BASE_URL ||
        process.env.OPENBLOCK_API_ORIGIN ||
        process.env.VITE_API_BASE_URL ||
        'http://0.0.0.0:5000';
    return String(raw).replace(/\/+$/, '');
}
