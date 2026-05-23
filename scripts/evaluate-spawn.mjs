#!/usr/bin/env node
/* global process, console */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

const SPAWN_EVAL_POLICIES = ['random', 'clear-greedy', 'survival'];
const SPAWN_EVAL_STRATEGIES = ['easy', 'normal', 'hard'];
const SPAWN_EVAL_GENERATORS = ['baseline', 'triplet-p1', 'budget-p2'];

function parseList(value, fallback) {
    if (!value) return fallback;
    const items = String(value).split(',').map((s) => s.trim()).filter(Boolean);
    return items.length ? items : fallback;
}

function parseArgs(argv) {
    const opts = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === '--sessions') opts.sessions = Number(next), i++;
        else if (arg === '--max-steps') opts.maxSteps = Number(next), i++;
        else if (arg === '--max-triplets') opts.maxEvaluatedTriplets = Number(next), i++;
        else if (arg === '--best-score') opts.bestScore = Number(next), i++;
        else if (arg === '--seed') opts.seed = Number(next), i++;
        else if (arg === '--strategy' || arg === '--strategies') opts.strategies = parseList(next, SPAWN_EVAL_STRATEGIES), i++;
        else if (arg === '--policy' || arg === '--policies') opts.policies = parseList(next, SPAWN_EVAL_POLICIES), i++;
        else if (arg === '--spawn-generator' || arg === '--spawn-generators') opts.spawnGenerators = parseList(next, SPAWN_EVAL_GENERATORS), i++;
        else if (arg === '--personalization') opts.modelConfig = { ...(opts.modelConfig || {}), personalizationStrength: Number(next) }, i++;
        else if (arg === '--temperature') opts.modelConfig = { ...(opts.modelConfig || {}), temperature: Number(next) }, i++;
        else if (arg === '--surprise-gain') opts.modelConfig = { ...(opts.modelConfig || {}), surpriseBudgetGain: Number(next) }, i++;
        else if (arg === '--surprise-cooldown') opts.modelConfig = { ...(opts.modelConfig || {}), surpriseCooldown: Number(next) }, i++;
        else if (arg === '--out') opts.out = next, i++;
        else if (arg === '--help' || arg === '-h') opts.help = true;
    }
    return opts;
}

function usage() {
    return [
        '用法: npm run spawn:eval -- [options]',
        '',
        'Options:',
        '  --sessions 120                每组跑局数',
        '  --max-steps 360               单局最大落子数',
        '  --max-triplets 80             P1/P2 每次出块最多评估的三块组合数',
        '  --best-score 1000             PB 双 S 曲线评估用个人最佳分',
        '  --seed 20260523               随机种子',
        '  --strategies easy,normal,hard  难度列表',
        '  --policies random,survival     bot 策略列表',
        '  --spawn-generators baseline,triplet-p1,budget-p2  出块生成器列表',
        '  --personalization 0.12         个性化预算强度',
        '  --temperature 0.08             受控随机 softmax 温度',
        '  --surprise-gain 0.10           惊喜预算增长',
        '  --surprise-cooldown 6          惊喜预算冷却轮次',
        '  --out path/to/report.json      写入 JSON 文件；省略则输出到 stdout',
    ].join('\n');
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
    console.log(usage());
    process.exit(0);
}

const { out, ...evalOptions } = args;
const server = await createServer({
    configFile: false,
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
});

let report;
try {
    const mod = await server.ssrLoadModule('/web/src/bot/spawnEvaluation.js');
    report = mod.runSpawnEvaluation(evalOptions);
} finally {
    await server.close();
}
const json = JSON.stringify(report, null, 2);

if (out) {
    const target = resolve(process.cwd(), out);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, json + '\n', 'utf8');
    console.log(`spawn evaluation written: ${target}`);
} else {
    console.log(json);
}

