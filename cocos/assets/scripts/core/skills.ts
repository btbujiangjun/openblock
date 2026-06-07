/**
 * 技能定义与纯逻辑（Phase 3）。具体盘面变更由 GameModel 方法执行，
 * 这里只放「定义 + 不改状态的查询（如 hint）」，UI 负责交互编排。
 */
import { Grid } from './grid';
import { DockBlock } from './types';
import { WalletKind } from './economy';

export type SkillId = 'hint' | 'undo' | 'bomb' | 'rainbow' | 'freeze' | 'reroll' | 'preview' | 'aim';

export interface SkillDef {
    id: SkillId;
    name: string;
    /** i18n key（优先于 name） */
    nameKey: string;
    icon: string;
    cost: number;
    /** 是否需要在盘面上点选目标（bomb） */
    needsTarget: boolean;
    /**
     * 关联钱包通货（对齐 web skillBar `kind`）：每次使用消耗 1 个对应道具。
     * null 表示无消耗（aim 仅本地开关，免费）。
     */
    tokenKind: WalletKind | null;
}

export const SKILLS: Record<SkillId, SkillDef> = {
    hint: { id: 'hint', name: '提示', nameKey: 'skill.hint', icon: '💡', cost: 5, needsTarget: false, tokenKind: 'hintToken' },
    undo: { id: 'undo', name: '撤销', nameKey: 'skill.undo', icon: '↩️', cost: 15, needsTarget: false, tokenKind: 'undoToken' },
    bomb: { id: 'bomb', name: '炸弹', nameKey: 'skill.bomb', icon: '💣', cost: 25, needsTarget: true, tokenKind: 'bombToken' },
    rainbow: { id: 'rainbow', name: '彩虹', nameKey: 'skill.rainbow', icon: '🌈', cost: 30, needsTarget: false, tokenKind: 'rainbowToken' },
    freeze: { id: 'freeze', name: '冻结', nameKey: 'skill.freeze', icon: '❄️', cost: 20, needsTarget: false, tokenKind: 'freezeToken' },
    reroll: { id: 'reroll', name: '换一批', nameKey: 'skill.reroll', icon: '🔄', cost: 10, needsTarget: false, tokenKind: 'rerollToken' },
    preview: { id: 'preview', name: '预览', nameKey: 'skill.preview', icon: '👁️', cost: 8, needsTarget: false, tokenKind: 'previewToken' },
    aim: { id: 'aim', name: '瞄准', nameKey: 'skill.aim', icon: '🎯', cost: 0, needsTarget: false, tokenKind: null },
};

export const SKILL_ORDER: SkillId[] = ['hint', 'undo', 'reroll', 'bomb', 'rainbow', 'freeze', 'preview', 'aim'];

export interface PreviewPlacement {
    index: number;
    gx: number;
    gy: number;
    clears: number;
}

/** 列出每块候选的最佳落点（预览技能用）：优先消行多的点。 */
export function listBestPlacements(grid: Grid, dock: DockBlock[]): PreviewPlacement[] {
    const out: PreviewPlacement[] = [];
    for (const b of dock) {
        if (b.placed) continue;
        let best: PreviewPlacement | null = null;
        for (let y = 0; y < grid.size; y++) {
            for (let x = 0; x < grid.size; x++) {
                if (!grid.canPlace(b.shape, x, y)) continue;
                const oc = grid.previewClearOutcome(b.shape, x, y, b.colorIdx);
                const clears = oc ? oc.rows.length + oc.cols.length : 0;
                if (!best || clears > best.clears) best = { index: b.index, gx: x, gy: y, clears };
            }
        }
        if (best) out.push(best);
    }
    return out;
}

export interface HintResult {
    index: number;
    gx: number;
    gy: number;
}

/** 找一个可行落点（优先能消行的）。不修改状态。 */
export function findHint(grid: Grid, dock: DockBlock[]): HintResult | null {
    let fallback: HintResult | null = null;
    for (const b of dock) {
        if (b.placed) continue;
        for (let y = 0; y < grid.size; y++) {
            for (let x = 0; x < grid.size; x++) {
                if (!grid.canPlace(b.shape, x, y)) continue;
                const oc = grid.previewClearOutcome(b.shape, x, y, b.colorIdx);
                if (oc && oc.rows.length + oc.cols.length > 0) {
                    return { index: b.index, gx: x, gy: y };
                }
                if (!fallback) fallback = { index: b.index, gx: x, gy: y };
            }
        }
    }
    return fallback;
}
