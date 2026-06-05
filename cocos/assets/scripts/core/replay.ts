/**
 * 对局回放（Phase P2 —— 对齐 web replay）。
 *
 * 录制：每次成功落子记一帧 { shape, colorIdx, gx, gy }。回看时用引擎无关的 Grid.place + checkLines
 * 逐帧确定性重建盘面（消行规则与实战一致），无需引擎/RNG → 跨端可复现、存储紧凑。
 */
import { ShapeMatrix } from './types';

export interface ReplayMove {
    shape: ShapeMatrix;
    colorIdx: number;
    gx: number;
    gy: number;
}

export interface ReplayData {
    id: string;
    date: number;
    mode: string;
    skinId: string;
    size: number;
    score: number;
    best: number;
    moves: ReplayMove[];
}

/** 单局录制器：startGame 时 begin，落子时 record，结算时 finish 产出可存档数据。 */
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

    record(move: ReplayMove): void {
        // 深拷贝 shape，避免后续复用同一矩阵引用导致回放数据被污染。
        this.moves.push({
            shape: move.shape.map((row) => row.slice()),
            colorIdx: move.colorIdx,
            gx: move.gx,
            gy: move.gy,
        });
    }

    get moveCount(): number {
        return this.moves.length;
    }

    /** 结算产出（无落子返回 null，不存空回放）。 */
    finish(score: number): ReplayData | null {
        if (this.moves.length === 0) return null;
        return {
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
