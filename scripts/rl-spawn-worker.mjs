#!/usr/bin/env node
/**
 * 持久化出块 worker（Vite SSR 加载 web 模块，与线上一致）。
 * 协议：每行 JSON 请求 → 每行 JSON 响应。
 */
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'vite';

// stdout 是与 Python 通信的 JSON 协议专用通道：任何模块（含 Vite/依赖）的
// console.* 都必须改写到 stderr，否则会污染响应行，导致对端 JSON 解析失败/请求错位。
for (const level of ['log', 'info', 'warn', 'debug']) {
    console[level] = (...args) => process.stderr.write(`${args.map(String).join(' ')}\n`);
}

const _root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
    configFile: false,
    root: _root,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false },
});
const { spawnDockOnlineSnapshot } = await server.ssrLoadModule('/web/src/bot/rlSpawnBridge.js');

// 不传 output，避免 readline 对输入行产生任何回显写入 stdout。
const rl = readline.createInterface({ input: process.stdin, terminal: false });

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
