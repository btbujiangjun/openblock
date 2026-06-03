#!/usr/bin/env node
/**
 * P5 — is_exact_match 与「惩罚 / 偏离族」离线回算。
 *
 * 系统不记录每步的「设计 / 最优落点」，故 `is_exact_match` 及其派生的惩罚偏离族
 * 无法实时计算。本工具离线确定性重建每局盘面轨迹，对每个真实落子，用 **贪心基线**
 * （greedy ≈ 最优：先最大化消行，再最小化新空洞，再最小化填充）算出该块的「最优落点」，
 * 与玩家真实落点比对得到 `is_exact_match`，再聚合：
 *   - exact_match_rate    走最优路径概率（越低 = 越易诱导歧途）
 *   - think_exact/deviated 最优 vs 偏离的思考耗时
 *   - blast_exact/deviated 最优 vs 偏离的消行
 *   - think_punish_index  = (think_deviated − think_exact) / (think_exact + ε)（认知陷阱深度）
 *
 * 注意（见 ALGORITHMS_SPAWN.md §14.二 风险表）：贪心 ≠ 全局最优，仅作实用近似；
 * 也可换成更强的 lookahead 基线。本工具只读、不写回。
 *
 * 用法：
 *   node scripts/audit-exact-match.mjs --sqlite openblock.db --pretty
 *   node scripts/audit-exact-match.mjs --sessions tmp/sessions.json --json-out tmp/exact-match.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * 最小自包含盘面（避免 import web/src/grid.js 牵出 shared/shapes.json 的
 * import-attributes 依赖，使本脚本在原生 Node 下可直接运行）。
 * 语义与 web/src/grid.js 的 canPlace/place/checkLines 子集一致。
 */
class MiniBoard {
    constructor(size = 8) {
        this.size = size;
        this.cells = Array.from({ length: size }, () => Array(size).fill(null));
    }

    static fromJSON(data) {
        const b = new MiniBoard(data?.size || 8);
        if (Array.isArray(data?.cells)) b.cells = data.cells.map((row) => [...row]);
        return b;
    }

    clone() {
        const b = new MiniBoard(this.size);
        b.cells = this.cells.map((row) => [...row]);
        return b;
    }

    canPlace(shape, gx, gy) {
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (!shape[y][x]) continue;
                const cx = gx + x;
                const cy = gy + y;
                if (cx < 0 || cy < 0 || cx >= this.size || cy >= this.size) return false;
                if (this.cells[cy][cx] !== null) return false;
            }
        }
        return true;
    }

    place(shape, colorIdx, gx, gy) {
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x]) this.cells[gy + y][gx + x] = colorIdx;
            }
        }
    }

    /** 检测并清除满行/满列，返回清除条数（行+列）。 */
    checkLines() {
        const n = this.size;
        const fullRows = [];
        const fullCols = [];
        for (let y = 0; y < n; y++) if (this.cells[y].every((c) => c !== null)) fullRows.push(y);
        for (let x = 0; x < n; x++) {
            let full = true;
            for (let y = 0; y < n; y++) if (this.cells[y][x] === null) { full = false; break; }
            if (full) fullCols.push(x);
        }
        for (const y of fullRows) for (let x = 0; x < n; x++) this.cells[y][x] = null;
        for (const x of fullCols) for (let y = 0; y < n; y++) this.cells[y][x] = null;
        return { count: fullRows.length + fullCols.length };
    }
}

function parseArgs(argv) {
    const opts = { pretty: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const n = argv[i + 1];
        if (a === '--sqlite') { opts.sqlite = n; i++; }
        else if (a === '--sessions') { opts.sessions = n; i++; }
        else if (a === '--days') { opts.days = Number(n); i++; }
        else if (a === '--json-out') { opts.jsonOut = n; i++; }
        else if (a === '--revive-rate') { opts.reviveRate = Number(n); i++; }
        else if (a === '--pretty') { opts.pretty = true; }
        else if (a === '--help' || a === '-h') { opts.help = true; }
        else throw new Error(`未知参数：${a}`);
    }
    return opts;
}

function usage() {
    return [
        '用法: node scripts/audit-exact-match.mjs [options]',
        '  --sqlite path/to/openblock.db    从 SQLite move_sequences 读取 frames',
        '  --sessions path/to/sessions.json [{sessionId,userId,frames}] / {sessions|items:[...]}',
        '  --days N        仅 SQLite：近 N 天；0=全部',
        '  --json-out path 输出结构化 JSON',
        '  --revive-rate r composite 用的复活率（0~1，behaviors 导出；缺省按 0 计）',
        '  --pretty        在 stdout 打印摘要',
    ].join('\n');
}

async function loadSqliteDriver() {
    try {
        const mod = await import('better-sqlite3');
        return mod.default;
    } catch (e) {
        throw new Error(`读取 SQLite 需要 better-sqlite3。原始错误：${e?.message || e}`);
    }
}

function parseFramesJson(text, sessionId) {
    try {
        const frames = JSON.parse(text || '[]');
        return Array.isArray(frames) ? frames : [];
    } catch {
        if (sessionId != null) console.warn(`跳过 session=${sessionId}：frames JSON 损坏`);
        return [];
    }
}

async function loadFromSqlite(dbPath, days) {
    const Database = await loadSqliteDriver();
    const db = new Database(resolve(process.cwd(), dbPath), { readonly: true });
    try {
        const rows = db.prepare(
            'SELECT m.session_id AS session_id, m.user_id AS user_id, m.frames AS frames, s.end_time AS end_time ' +
            'FROM move_sequences m LEFT JOIN sessions s ON s.id = m.session_id ' +
            'WHERE m.frames IS NOT NULL ORDER BY m.session_id DESC'
        ).all();
        const sinceMs = days > 0 ? Date.now() - days * 86400_000 : 0;
        const sessions = [];
        for (const row of rows) {
            const t = Number(row.end_time);
            const endMs = Number.isFinite(t) && t > 0 ? (t > 1e12 ? t : t * 1000) : null;
            if (sinceMs > 0 && endMs != null && endMs < sinceMs) continue;
            const frames = parseFramesJson(row.frames, row.session_id);
            if (frames.length === 0) continue;
            sessions.push({ sessionId: row.session_id, userId: row.user_id, frames });
        }
        return sessions;
    } finally {
        db.close();
    }
}

async function loadSessionsFile(path) {
    const data = JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8'));
    const raw = Array.isArray(data) ? data
        : Array.isArray(data?.sessions) ? data.sessions
            : Array.isArray(data?.items) ? data.items : [];
    return raw.map((s, idx) => {
        const frames = Array.isArray(s.frames) ? s.frames
            : typeof s.move_frames === 'string' ? parseFramesJson(s.move_frames, s.id ?? idx)
                : Array.isArray(s.move_frames) ? s.move_frames : [];
        return { sessionId: s.sessionId ?? s.session_id ?? s.id ?? idx, userId: s.userId ?? s.user_id ?? null, frames };
    }).filter((s) => s.frames.length > 0);
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** 4-邻全填（含边界）的孤立空格数——轻量、自包含（不依赖形状池）。 */
function countIsolatedHoles(grid) {
    const n = grid.size;
    let h = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) continue;
            const up = y === 0 || grid.cells[y - 1][x] !== null;
            const dn = y === n - 1 || grid.cells[y + 1][x] !== null;
            const lf = x === 0 || grid.cells[y][x - 1] !== null;
            const rt = x === n - 1 || grid.cells[y][x + 1] !== null;
            if (up && dn && lf && rt) h++;
        }
    }
    return h;
}

function fillCount(grid) {
    let c = 0;
    for (let y = 0; y < grid.size; y++) for (let x = 0; x < grid.size; x++) if (grid.cells[y][x] !== null) c++;
    return c;
}

/**
 * 贪心最优落点：枚举该形状全部合法落点，clone→place→checkLines 打分，
 * 取 score 最大集合。score = clears*1000 − holes*10 − fill。
 * @returns {Array<{x:number,y:number}>} argmax 落点集合（可能多个并列）
 */
function greedyBestPlacements(grid, shape) {
    const n = grid.size;
    let best = -Infinity;
    let bestSet = [];
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (!grid.canPlace(shape, x, y)) continue;
            const g = grid.clone();
            g.place(shape, 1, x, y);
            const cleared = g.checkLines().count;
            const holes = countIsolatedHoles(g);
            const fill = fillCount(g);
            const score = cleared * 1000 - holes * 10 - fill;
            if (score > best + 1e-9) {
                best = score;
                bestSet = [{ x, y }];
            } else if (Math.abs(score - best) <= 1e-9) {
                bestSet.push({ x, y });
            }
        }
    }
    return bestSet;
}

/** lines + 是否清屏 → 玩家策略深度链路标签（4 档）。 */
function chainLabel(lines, cleanScreen) {
    if (cleanScreen) return '3级清屏';
    if (lines >= 2) return '2级多消嵌套';
    if (lines === 1) return '1级单消';
    return '0级并行';
}

/** 重建一局轨迹，逐 place 判定 is_exact_match，返回逐步记录（含算法 / 客观难度抓手 / 链路标签）。 */
function auditSession(frames) {
    const initFrame = frames.find((f) => f?.t === 'init');
    if (!initFrame?.grid?.cells) return [];
    const grid = MiniBoard.fromJSON(initFrame.grid);

    let currentDock = null;
    let currentAlgo = 'unknown';
    let currentKiller = null;
    let currentFlex = null;
    const records = [];
    for (const f of frames) {
        if (f?.t === 'spawn') {
            currentDock = Array.isArray(f.dock) ? f.dock : null;
            currentAlgo = f?.ps?.strategyId ?? f?.ps?.adaptive?.strategyId ?? 'unknown';
            const sd = f?.spawnMeta?.stepDifficulty;
            currentKiller = sd && typeof sd === 'object' ? num(sd.comboKillerCnt) : null;
            currentFlex = sd && typeof sd === 'object' ? num(sd.minFlexibility) : null;
        } else if (f?.t === 'place') {
            const i = Number(f.i);
            const ax = Number(f.x);
            const ay = Number(f.y);
            const shape = currentDock?.[i]?.shape;
            if (!Array.isArray(shape) || !Number.isFinite(ax) || !Number.isFinite(ay)) continue;
            if (!grid.canPlace(shape, ax, ay)) {
                // 轨迹与盘面不一致（旧数据/特殊形状），跳过该步但不污染统计
                continue;
            }
            const bestSet = greedyBestPlacements(grid, shape);
            const isExact = bestSet.some((p) => p.x === ax && p.y === ay);
            // 推进真实落子
            grid.place(shape, 1, ax, ay);
            const lines = grid.checkLines().count;
            const cleanScreen = lines > 0 && fillCount(grid) === 0;
            records.push({
                isExact,
                algo: currentAlgo,
                thinkMs: num(f?.ps?.metrics?.thinkMs),
                lines,
                cleanScreen,
                chainLabel: chainLabel(lines, cleanScreen),
                comboKillerCnt: currentKiller,
                minFlexibility: currentFlex,
                legalOptima: bestSet.length
            });
        }
    }
    return records;
}

function mean(xs) {
    const ys = xs.filter((v) => Number.isFinite(v));
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
}

const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/** (think_deviated − think_exact) / (think_exact + ε)，单位 ms 不影响比值。 */
function punishIndexOf(records) {
    const exact = records.filter((r) => r.isExact);
    const dev = records.filter((r) => !r.isExact);
    const te = mean(exact.map((r) => r.thinkMs));
    const td = mean(dev.map((r) => r.thinkMs));
    return te != null && td != null ? (td - te) / (te + 0.001) : null;
}

/** max_punish_index 三档 → 陷阱深度标签。 */
function punishmentLabel(maxPunish) {
    if (maxPunish == null) return null;
    if (maxPunish <= 0.5) return '宽容型';
    if (maxPunish <= 1.5) return '中等型';
    return '致命型';
}

/** composite_difficulty_score → 五档难度标签。 */
function difficultySubLabel(score) {
    if (score == null) return null;
    if (score < 20) return '极简';
    if (score < 40) return '简单';
    if (score < 60) return '标准';
    if (score < 80) return '困难';
    return '极限';
}

/**
 * 全局统一难度坐标（composite_difficulty_score）说明：表现项（think/match/punish/
 * revive）+ 客观项（killer/flex）加权和，用于跨算法比较。reviveRate 不在 move
 * frames 内，需 --revive-rate 外部传入（behaviors 导出），缺省按 0 计并在报告中标注。
 * flexibilityFree=24 用于把 minFlexibility（合法落点数）归一化到 0~1 的
 * flexibility_score 口径。展开公式见 aggregate() 内。
 */
function aggregate(allRecords, opts = {}) {
    const total = allRecords.length;
    const exact = allRecords.filter((r) => r.isExact);
    const deviated = allRecords.filter((r) => !r.isExact);
    const thinkExact = mean(exact.map((r) => r.thinkMs));
    const thinkDeviated = mean(deviated.map((r) => r.thinkMs));
    const punishIndex = punishIndexOf(allRecords);

    /* 按算法分组 → 各算法 think_punish_index → max_punish_index（该步型『认知陷阱深度上限』） */
    const byAlgo = {};
    for (const r of allRecords) (byAlgo[r.algo ?? 'unknown'] ??= []).push(r);
    const algoPunish = {};
    for (const [a, rs] of Object.entries(byAlgo)) algoPunish[a] = punishIndexOf(rs);
    const punishVals = Object.values(algoPunish).filter((v) => Number.isFinite(v));
    const maxPunishIndex = punishVals.length ? Math.max(...punishVals) : punishIndex;

    /* 链路标签分布（玩家策略深度分层） */
    const chainDist = {};
    for (const r of allRecords) chainDist[r.chainLabel] = (chainDist[r.chainLabel] ?? 0) + 1;
    const chainRates = {};
    for (const [k, v] of Object.entries(chainDist)) chainRates[k] = total ? v / total : 0;

    /* composite_difficulty_score（提案权重展开）：
     *   0.25*think/10 + 0.20*(1-match)*100 + 0.15*punish*10
     *   + 0.15*revive*100 + 0.15*killer*20 + 0.10*(1-flex)*100 */
    const matchRate = total ? exact.length / total : null;
    const thinkSec = (mean(allRecords.map((r) => r.thinkMs)) ?? 0) / 1000;
    const reviveRate = Number.isFinite(opts.reviveRate) ? opts.reviveRate : null;
    const killerMean = mean(allRecords.map((r) => r.comboKillerCnt));
    const flexScore = clamp01((mean(allRecords.map((r) => r.minFlexibility)) ?? 0) / 24);
    const compositeScore = matchRate == null ? null : (
        0.25 * (thinkSec / 10)
        + 0.20 * (1 - matchRate) * 100
        + 0.15 * (punishIndex ?? 0) * 10
        + 0.15 * (reviveRate ?? 0) * 100
        + 0.15 * (killerMean ?? 0) * 20
        + 0.10 * (1 - flexScore) * 100
    );

    return {
        totalSteps: total,
        exactMatchRate: matchRate,
        thinkExact, thinkDeviated,
        thinkPunishIndex: punishIndex,
        maxPunishIndex,
        punishmentLabel: punishmentLabel(maxPunishIndex),
        algoPunishIndex: algoPunish,
        blastExact: mean(exact.map((r) => r.lines)),
        blastDeviated: mean(deviated.map((r) => r.lines)),
        chainLabelCounts: chainDist,
        chainLabelRates: chainRates,
        cleanScreenRate: total ? allRecords.filter((r) => r.cleanScreen).length / total : null,
        reviveRate,
        killerMean,
        flexScore,
        compositeDifficultyScore: compositeScore,
        difficultySubLabel: difficultySubLabel(compositeScore),
        meanLegalOptima: mean(allRecords.map((r) => r.legalOptima))
    };
}

function prettyPrint(agg) {
    const f = (v, d = 3) => (v == null ? '—' : v.toFixed(d));
    const chain = Object.entries(agg.chainLabelRates || {})
        .map(([k, v]) => `${k}=${f(v, 2)}`).join('  ') || '—';
    return [
        `总落子步数: ${agg.totalSteps}`,
        `exact_match_rate（走最优落点概率）: ${f(agg.exactMatchRate)}`,
        `think_exact / think_deviated (ms): ${f(agg.thinkExact, 0)} / ${f(agg.thinkDeviated, 0)}`,
        `think_punish_index（认知陷阱深度）: ${f(agg.thinkPunishIndex)}`,
        `max_punish_index（陷阱深度上限·跨算法）: ${f(agg.maxPunishIndex)}  → ${agg.punishmentLabel ?? '—'}`,
        `blast_exact / blast_deviated: ${f(agg.blastExact)} / ${f(agg.blastDeviated)}`,
        `chain_label 分布: ${chain}`,
        `clean_screen_rate: ${f(agg.cleanScreenRate)}`,
        `composite_difficulty_score: ${f(agg.compositeDifficultyScore, 2)}  → ${agg.difficultySubLabel ?? '—'}` +
            (agg.reviveRate == null ? '（注：reviveRate 未提供，按 0 计；--revive-rate 可补全）' : ''),
        `平均并列最优落点数: ${f(agg.meanLegalOptima, 2)}`,
    ].join('\n');
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(usage()); return; }
    if (!opts.sqlite && !opts.sessions) {
        console.error('需要 --sqlite 或 --sessions 之一。\n');
        console.error(usage());
        process.exitCode = 1;
        return;
    }
    const sessions = opts.sqlite
        ? await loadFromSqlite(opts.sqlite, opts.days || 0)
        : await loadSessionsFile(opts.sessions);
    const allRecords = [];
    for (const s of sessions) {
        for (const r of auditSession(s.frames)) allRecords.push(r);
    }
    const agg = aggregate(allRecords, { reviveRate: opts.reviveRate });

    if (opts.jsonOut) {
        await mkdir(dirname(resolve(process.cwd(), opts.jsonOut)), { recursive: true });
        await writeFile(resolve(process.cwd(), opts.jsonOut), JSON.stringify(agg, null, 2), 'utf8');
        console.error(`已写出 ${opts.jsonOut}`);
    }
    if (opts.pretty || !opts.jsonOut) {
        console.log(prettyPrint(agg));
    }
}

import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

/* 仅在作为入口脚本直接运行时执行 main；被测试 import 时不触发。 */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(argv[1])) {
    main().catch((err) => {
        console.error(err?.stack || err?.message || String(err));
        process.exitCode = 1;
    });
}

export {
    auditSession, greedyBestPlacements, aggregate, countIsolatedHoles,
    chainLabel, punishmentLabel, difficultySubLabel, punishIndexOf,
};
