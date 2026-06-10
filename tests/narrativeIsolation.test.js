/**
 * v1.69.3 算法叙事文案的平台隔离静态检查。
 *
 * 约束（详见 docs/algorithms/REALTIME_STRATEGY.md §"叙事文案的平台可见性约束"）：
 * web 主端的"算法决策叙事"（含「投放/促清/识别到密集消行机会」等算法泄露式描述）
 * 只允许在 web 主端的 debug 面板出现，**禁止**出现在小程序 / Cocos 端的任何 UI 渲染路径。
 *
 * 现状（v1.69.3 实施时）：
 *   - displayContracts / stressMeter / playerInsightPanel：**未** 同步到 mp/cocos
 *     （sync-core.sh / sync-cocos-engine.mjs 名单不含这三者）
 *   - cocos lifecyclePlaybook.intentNarrative：被 GameController.maybeShowStrategyHint
 *     消费，已用 globalThis.__OB_COCOS_STRATEGY_HINT__ 门控，默认隐藏
 *
 * 本测试守住三条静态边界，防止未来误回归：
 *   1) miniprogram/ 与 cocos/ 不得 import displayContracts / stressMeter / playerInsightPanel
 *   2) sync-core.sh / sync-cocos-engine.mjs 同步清单不得包含上述三个文件名
 *   3) cocos GameController.maybeShowStrategyHint 必须显式门控（不能裸调 Toast.show）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..');

/** 递归收集目录下匹配扩展名的文件 */
function walk(dir, exts, out = []) {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.git' || name === 'build' || name === 'temp') continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, exts, out);
        else if (exts.some((e) => name.endsWith(e))) out.push(full);
    }
    return out;
}

const FORBIDDEN_MODULES = [
    'displayContracts',
    'stressMeter',
    'playerInsightPanel',
    'decisionFlowViz',
    'strategyAdvisor',
];

describe('v1.69.3 算法叙事文案的平台隔离', () => {
    it('miniprogram/ 不得 require/import 任何 web 端 debug 叙事模块', () => {
        const files = walk(join(REPO, 'miniprogram'), ['.js', '.wxml', '.ts']);
        const offenders = [];
        for (const f of files) {
            const text = readFileSync(f, 'utf8');
            for (const mod of FORBIDDEN_MODULES) {
                // 仅匹配 import/require 语句（避免注释里提到的合法引用）
                const re = new RegExp(
                    `(require\\(['"][^'"]*${mod}|from\\s+['"][^'"]*${mod}|import\\s+['"][^'"]*${mod})`,
                );
                if (re.test(text)) offenders.push(`${f}: imports ${mod}`);
            }
        }
        expect(offenders, `小程序端泄露 web debug 叙事模块:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('cocos/assets/scripts/ 不得 import 任何 web 端 debug 叙事模块', () => {
        const files = walk(join(REPO, 'cocos/assets/scripts'), ['.ts', '.mjs', '.js']);
        const offenders = [];
        for (const f of files) {
            const text = readFileSync(f, 'utf8');
            for (const mod of FORBIDDEN_MODULES) {
                const re = new RegExp(
                    `(import\\s+[^;]*from\\s+['"][^'"]*${mod}|require\\(['"][^'"]*${mod})`,
                );
                if (re.test(text)) offenders.push(`${f}: imports ${mod}`);
            }
        }
        expect(offenders, `Cocos 端泄露 web debug 叙事模块:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('sync-core.sh 同步清单不得包含 web debug 叙事模块', () => {
        const sh = readFileSync(join(REPO, 'scripts/sync-core.sh'), 'utf8');
        for (const mod of FORBIDDEN_MODULES) {
            // 严格匹配作为文件名/路径出现（带 .js 或路径分隔）
            const re = new RegExp(`(^|[/\\s])${mod}\\.js(\\s|$)`, 'm');
            expect(re.test(sh), `sync-core.sh 不应同步 ${mod}.js 到小程序`).toBe(false);
        }
    });

    it('sync-cocos-engine.mjs 同步清单不得包含 web debug 叙事模块', () => {
        const mjs = readFileSync(join(REPO, 'scripts/sync-cocos-engine.mjs'), 'utf8');
        for (const mod of FORBIDDEN_MODULES) {
            const re = new RegExp(`(^|[/\\s'"])${mod}\\.js(\\s|$|['"])`, 'm');
            expect(re.test(mjs), `sync-cocos-engine.mjs 不应同步 ${mod}.js 到 Cocos`).toBe(false);
        }
    });

    it('Cocos GameController.maybeShowStrategyHint 必须有平台门控（不能裸调 Toast.show）', () => {
        const ts = readFileSync(join(REPO, 'cocos/assets/scripts/game/GameController.ts'), 'utf8');
        // 提取 maybeShowStrategyHint 方法体（粗匹配：从方法名到下一个 private/public 声明）
        const m = ts.match(/private maybeShowStrategyHint\(\)[\s\S]*?\n {4}(?:private|public|protected|\/\*\*)/);
        expect(m, 'GameController.ts 找不到 maybeShowStrategyHint 方法').toBeTruthy();
        const body = m[0];
        // 必须含门控字串
        expect(body, 'maybeShowStrategyHint 必须用 __OB_COCOS_STRATEGY_HINT__ 门控').toMatch(
            /__OB_COCOS_STRATEGY_HINT__/,
        );
    });
});
