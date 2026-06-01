/**
 * 寻参 v2 离线 bundle 版本管理契约：
 * - web/public/spawn-tuning-v2/policies.json 为权威 JSON
 * - miniprogram/core/tuning/v2/spawnPoliciesV2.js 由 sync-spawn-bundle 生成且语义一致
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { syncSpawnBundle } from '../scripts/sync-spawn-bundle.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const WEB_BUNDLE = path.join(ROOT, 'web/public/spawn-tuning-v2/policies.json');
const WEB_META = path.join(ROOT, 'web/public/spawn-tuning-v2/policies.meta.json');
const MP_TARGET = path.join(ROOT, 'miniprogram/core/tuning/v2/spawnPoliciesV2.js');

describe('spawn tuning v2 bundle sync', () => {
    it('web bundle 存在且格式正确', () => {
        expect(fs.existsSync(WEB_BUNDLE)).toBe(true);
        const data = JSON.parse(fs.readFileSync(WEB_BUNDLE, 'utf8'));
        expect(data.format).toBe('openblock-spawn-tuning-v2-bundle');
        expect(Array.isArray(data.policies)).toBe(true);
        expect(data.policies.length).toBeGreaterThan(0);
    });

    it('policies.meta.json sha256 与 policies.json 一致', () => {
        expect(fs.existsSync(WEB_META)).toBe(true);
        const raw = fs.readFileSync(WEB_BUNDLE, 'utf8');
        const meta = JSON.parse(fs.readFileSync(WEB_META, 'utf8'));
        const sha = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
        expect(meta.sha256).toBe(sha);
    });

    it('小程序 CJS 模块与 web bundle 语义一致', () => {
        expect(fs.existsSync(MP_TARGET)).toBe(true);
        const result = syncSpawnBundle({ verify: true });
        expect(result.ok).toBe(true);
        expect(result.verified).toBe(true);
    });
});
