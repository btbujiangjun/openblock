#!/usr/bin/env node
/**
 * 将 web/public/spawn-tuning-v2/policies.json 同步为
 * miniprogram/core/tuning/v2/spawnPoliciesV2.js（CJS 数据模块）。
 *
 * Web / Android / iOS：Vite 构建时自动复制 web/public → dist/spawn-tuning-v2/
 * 微信小程序：require 上述 CJS 模块，app.js 启动时 initClientPolicyV2({ bundleData })
 *
 * 用法：
 *   node scripts/sync-spawn-bundle.mjs
 *   node scripts/sync-spawn-bundle.mjs --verify   # 校验 web ↔ 小程序 bundle 一致
 */
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_BUNDLE = path.join(ROOT, 'web/public/spawn-tuning-v2/policies.json');
const WEB_META = path.join(ROOT, 'web/public/spawn-tuning-v2/policies.meta.json');
const MP_TARGET = path.join(ROOT, 'miniprogram/core/tuning/v2/spawnPoliciesV2.js');
const MP_LEGACY = path.join(ROOT, 'miniprogram/core/tuning/spawnPoliciesV2.js');

function sha256(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function parseModuleExport(filePath) {
    const src = fs.readFileSync(filePath, 'utf8');
    const marker = 'module.exports = ';
    const idx = src.indexOf(marker);
    if (idx < 0) throw new Error(`missing module.exports in ${filePath}`);
    return JSON.parse(src.slice(idx + marker.length).trim().replace(/;\s*$/, ''));
}

export function buildMiniprogramSpawnModule(data, meta = {}) {
    const lines = [
        '小程序运行时数据模块 — 出块寻参 v2 策略 (离线包)',
        `来源: web/public/spawn-tuning-v2/policies.json`,
        `同步: scripts/sync-spawn-bundle.mjs @ ${new Date().toISOString()}`,
    ];
    if (meta.model_id != null) lines.push(`model_id: ${meta.model_id}`);
    if (meta.model_sha256) lines.push(`model_sha256: ${meta.model_sha256}`);
    if (meta.sha256) lines.push(`bundle_sha256: ${meta.sha256}`);
    lines.push(`policies_count: ${data.policies?.length ?? 0}`);
    if (meta.rollout_pct != null) lines.push(`rollout_pct: ${meta.rollout_pct}%`);
    const header = `/**\n${lines.map((l) => ` * ${l}`).join('\n')}\n */\n`;
    return `${header}module.exports = ${JSON.stringify(data, null, 2)};\n`;
}

export function syncSpawnBundle({ verify = false } = {}) {
    if (!fs.existsSync(WEB_BUNDLE)) {
        console.warn('[sync-spawn-bundle] skip — web/public/spawn-tuning-v2/policies.json 不存在');
        return { ok: false, skipped: true };
    }

    const raw = fs.readFileSync(WEB_BUNDLE, 'utf8');
    const data = JSON.parse(raw);
    if (data.format !== 'openblock-spawn-tuning-v2-bundle') {
        throw new Error(`invalid bundle format: ${data.format}`);
    }

    let meta = {};
    try {
        meta = JSON.parse(fs.readFileSync(WEB_META, 'utf8'));
    } catch { /* meta optional */ }

    const expectedSha = meta.sha256 || sha256(raw);
    const actualSha = sha256(raw);
    if (meta.sha256 && meta.sha256 !== actualSha) {
        throw new Error(
            `policies.meta.json sha256 mismatch: meta=${meta.sha256.slice(0, 12)}… actual=${actualSha.slice(0, 12)}…`,
        );
    }

    if (verify && fs.existsSync(MP_TARGET)) {
        const mpData = parseModuleExport(MP_TARGET);
        const webNorm = JSON.stringify(data);
        const mpNorm = JSON.stringify(mpData);
        if (webNorm !== mpNorm) {
            throw new Error('miniprogram spawnPoliciesV2.js 与 web policies.json 内容不一致，请运行 npm run sync:spawn-bundle');
        }
        console.log('[sync-spawn-bundle] verify OK — web ↔ miniprogram bundle 一致');
        return { ok: true, verified: true, policies: data.policies?.length ?? 0, sha256: actualSha };
    }

    fs.mkdirSync(path.dirname(MP_TARGET), { recursive: true });
    fs.writeFileSync(MP_TARGET, buildMiniprogramSpawnModule(data, { ...meta, sha256: actualSha }));

    if (fs.existsSync(MP_LEGACY)) {
        fs.unlinkSync(MP_LEGACY);
        console.log('[sync-spawn-bundle] removed legacy miniprogram/core/tuning/spawnPoliciesV2.js');
    }

    console.log(
        `[sync-spawn-bundle] OK → ${path.relative(ROOT, MP_TARGET)}`
        + ` (${data.policies?.length ?? 0} policies, sha256=${actualSha.slice(0, 12)}…)`,
    );
    return { ok: true, policies: data.policies?.length ?? 0, sha256: actualSha, target: MP_TARGET };
}

const verifyOnly = process.argv.includes('--verify');
const isMain = process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
    try {
        syncSpawnBundle({ verify: verifyOnly });
    } catch (err) {
        console.error('[sync-spawn-bundle] FAILED:', err.message || err);
        process.exit(1);
    }
}
