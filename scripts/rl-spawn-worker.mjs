#!/usr/bin/env node
/**
 * 持久化出块 worker（Vite SSR 加载 web 模块，与线上一致）。
 * 协议：每行 JSON 请求 → 每行 JSON 响应。
 */
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'vite';

const _root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
    configFile: false,
    root: _root,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
});
const { spawnDockOnlineSnapshot } = await server.ssrLoadModule('/web/src/bot/rlSpawnBridge.js');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

function reply(obj) {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
}

rl.on('line', async (line) => {
    if (!line.trim()) return;
    try {
        const req = JSON.parse(line);
        if (req.op !== 'spawn') {
            reply({ ok: false, error: `unknown op: ${req.op}` });
            return;
        }
        const out = spawnDockOnlineSnapshot(req.snapshot || {});
        reply({ ok: true, ...out });
    } catch (e) {
        reply({ ok: false, error: String(e?.message || e) });
    }
});

rl.on('close', async () => {
    await server.close();
    process.exit(0);
});
