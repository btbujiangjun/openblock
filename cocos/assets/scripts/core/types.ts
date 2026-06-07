/** 引擎无关的核心类型定义 —— 不依赖 Cocos，任何渲染端均可消费。 */

export type ShapeMatrix = number[][];

export interface ShapeDef {
    id: string;
    name: string;
    category: string;
    data: ShapeMatrix;
}

/** 候选区一块（dock block）的运行时状态 */
export interface DockBlock {
    index: number;
    shape: ShapeMatrix;
    shapeId: string;
    colorIdx: number;
    placed: boolean;
}

export interface ClearedCell {
    x: number;
    y: number;
    color: number | null;
}

export interface ClearResult {
    count: number;
    cells: ClearedCell[];
    bonusLines: Array<{ type: 'row' | 'col'; idx: number; colorIdx: number }>;
    /** 本次消除的整行 / 整列索引（对齐 web checkLines 追加字段；供 double-wave 等动效用，可选）。 */
    rows?: number[];
    cols?: number[];
}

export interface PreviewOutcome {
    rows: number[];
    cols: number[];
    cells: ClearedCell[];
}

/** 方块绘制风格（对齐 web；cocos 当前以扁平圆角近似，保留字段以备后续材质化）。 */
export type BlockDrawStyle =
    | 'glossy' | 'flat' | 'neon' | 'glass' | 'metal' | 'cartoon' | 'jelly' | 'pixel8' | 'bevel3d';

export interface Skin {
    id: string;
    name: string;
    blockColors: string[];
    /** 页面背景色 */
    cssBg: string;
    /** 空格子色 */
    gridCell: string;
    /** 盘面外框/容器底色 */
    gridOuter?: string;
    /** 网格线色（cocos 暂未画线，保留以对齐数据） */
    gridLine?: string | false;
    gridGap?: number;
    blockInset?: number;
    blockRadius?: number;
    blockStyle?: BlockDrawStyle;
    /** 消行闪光色（支持 rgba()） */
    clearFlash?: string;
    /** 方块 emoji 图标（带 icon 皮肤；用于同 icon 消行 bonus 判定与后续 icon 渲染） */
    blockIcons?: string[];
    uiDark?: boolean;
}

/** 近满线（差一格即可消除），用于 near-miss 体感反馈 */
export interface NearMissLine {
    kind: 'row' | 'col';
    idx: number;
}

/** GameModel 对外抛出的事件（渲染端据此播放动画/音效/特效） */
export type GameEvent =
    | { type: 'place'; index: number; gx: number; gy: number; colorIdx: number; shape: ShapeMatrix }
    | { type: 'clear'; result: ClearResult; clearScore: number; perfectClear: boolean; reason: ClearReason; comboCount?: number; comboMultiplier?: number }
    | { type: 'score'; score: number; delta: number }
    | { type: 'dock'; blocks: DockBlock[] }
    | { type: 'gameover'; score: number; best: number }
    | { type: 'wallet'; coins: number; delta: number }
    | { type: 'skill'; id: string; ok: boolean }
    | { type: 'freeze'; active: boolean; used: boolean }
    | { type: 'nearmiss'; lines: NearMissLine[]; placedCells: Array<{ x: number; y: number }>; maxLineFill: number }
    | { type: 'revive' }
    | { type: 'newgame' };

export type ClearReason = 'line' | 'bomb' | 'color' | 'revive';

/** 玩法模式 */
export type GameMode = 'classic' | 'zen' | 'lightning';
