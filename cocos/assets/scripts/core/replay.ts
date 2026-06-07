/**
 * 对局回放（Phase P2 —— 对齐 web replay）。
 *
 * 录制：
 *   - 落子（最常见）记 `{ kind: 'place', shape, colorIdx, gx, gy }`，回看时用引擎无关的 Grid.place + checkLines
 *     逐帧确定性重建盘面（消行规则与实战一致），无需引擎/RNG → 跨端可复现、存储紧凑。
 *   - 技能（bomb/rainbow/undo）执行后追加一帧 `{ kind: 'snapshot', cells }` 直接覆盖盘面状态，
 *     避免技能带来的"非落子状态变化"被后续 place 在错误状态上回放放大。
 *
 * 持久格式版本（顶层 `version`）：
 *   - v1（无 version 字段）：moves 全部为旧形 `{ shape, colorIdx, gx, gy }`，无 snapshot 帧。
 *   - v2（当前）：moves 是 union（place | snapshot），允许技能快照帧；新写入皆带 `version: 2`。
 *
 * 兼容策略：读取时永远不抛——`upgradeReplay` 会把任意 v1 升到 v2 在内存中处理；写入时统一带最新版本号。
 */
import { ShapeMatrix } from './types';

/** 当前写入的回放结构版本。任何新字段加入都要同步 +1 并在 upgradeReplay 里写迁移分支。 */
export const REPLAY_FORMAT_VERSION = 2 as const;
export type ReplayFormatVersion = typeof REPLAY_FORMAT_VERSION;

export type ReplayMove =
    | { kind: 'place'; shape: ShapeMatrix; colorIdx: number; gx: number; gy: number }
    | { kind: 'snapshot'; cells: (number | null)[][] };

/** 把任意旧/新格式 move 归一化为 union；旧数据无 kind 字段 → 视为 'place'。 */
export function normalizeReplayMove(raw: unknown): ReplayMove | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (r.kind === 'snapshot' && Array.isArray(r.cells)) {
        return { kind: 'snapshot', cells: r.cells as (number | null)[][] };
    }
    // 'place' 或 旧版无 kind
    if (Array.isArray(r.shape) && typeof r.colorIdx === 'number' && typeof r.gx === 'number' && typeof r.gy === 'number') {
        return { kind: 'place', shape: r.shape as ShapeMatrix, colorIdx: r.colorIdx, gx: r.gx, gy: r.gy };
    }
    return null;
}

export interface ReplayData {
    /** 持久格式版本。读取时若缺省按 v1 处理；写入永远是 REPLAY_FORMAT_VERSION。 */
    version?: ReplayFormatVersion;
    id: string;
    date: number;
    mode: string;
    skinId: string;
    size: number;
    score: number;
    best: number;
    moves: ReplayMove[];
}

/**
 * 把任意来源（本地存档 / 云端 / 旧版本）的回放对象升级到当前内存结构。
 * - 缺字段：填默认值，保证后续无 undefined 触发 NPE。
 * - 旧 move 形：通过 normalizeReplayMove 升到 union（snapshot 兼容）。
 * - 缺 version：补 REPLAY_FORMAT_VERSION（v1→v2，moves 仅 place 帧也是合法的 v2）。
 * 返回 null 表示数据完全不可识别（不是回放结构），调用方应丢弃。
 */
export function upgradeReplay(raw: unknown): ReplayData | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (!Array.isArray(r.moves)) return null;
    const moves: ReplayMove[] = [];
    for (const m of r.moves as unknown[]) {
        const norm = normalizeReplayMove(m);
        if (norm) moves.push(norm);
    }
    if (moves.length === 0) return null;
    return {
        version: REPLAY_FORMAT_VERSION,
        id: typeof r.id === 'string' ? r.id : `${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        date: typeof r.date === 'number' ? r.date : Date.now(),
        mode: typeof r.mode === 'string' ? r.mode : 'classic',
        skinId: typeof r.skinId === 'string' ? r.skinId : 'classic',
        size: typeof r.size === 'number' ? r.size : 8,
        score: typeof r.score === 'number' ? r.score : 0,
        best: typeof r.best === 'number' ? r.best : 0,
        moves,
    };
}

/** 单局录制器：startGame 时 begin，落子/技能后 record，结算时 finish 产出可存档数据。 */
export class ReplayRecorder {
    private size = 8;
    private mode = 'classic';
    private skinId = 'classic';
    private best = 0;
    private moves: ReplayMove[] = [];

    begin(size: number, mode: string, skinId: string, best: number): void {
        this.size = size;
        this.mode = mode;
        this.skinId = skinId;
        this.best = best;
        this.moves = [];
    }

    /** 记一次落子（深拷贝 shape，避免后续复用同一矩阵引用导致回放数据被污染）。 */
    recordPlace(shape: ShapeMatrix, colorIdx: number, gx: number, gy: number): void {
        this.moves.push({
            kind: 'place',
            shape: shape.map((row) => row.slice()),
            colorIdx,
            gx,
            gy,
        });
    }

    /** 记一次盘面快照（深拷贝 cells）：技能触发后调用，让回放跳过技能本身、直接对齐技能后状态。 */
    recordSnapshot(cells: (number | null)[][]): void {
        this.moves.push({
            kind: 'snapshot',
            cells: cells.map((row) => row.slice()),
        });
    }

    /** 旧 API 兼容：旧调用方传 { shape, colorIdx, gx, gy } 落子帧。 */
    record(move: { shape: ShapeMatrix; colorIdx: number; gx: number; gy: number }): void {
        this.recordPlace(move.shape, move.colorIdx, move.gx, move.gy);
    }

    get moveCount(): number {
        return this.moves.length;
    }

    /** 结算产出（无落子返回 null，不存空回放）。新写入永远带最新 version。 */
    finish(score: number): ReplayData | null {
        if (this.moves.length === 0) return null;
        return {
            version: REPLAY_FORMAT_VERSION,
            id: `${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
            date: Date.now(),
            mode: this.mode,
            skinId: this.skinId,
            size: this.size,
            score,
            best: this.best,
            moves: this.moves.slice(),
        };
    }
}
