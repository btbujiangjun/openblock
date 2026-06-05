/**
 * 季节皮肤（Phase P2）：按月份给出建议皮肤 id（玩家未手动选皮肤时使用）。
 * 与压力氛围（FxLayer 环境层）配合营造节令感。引擎无关取数，落地由 Bootstrap 应用。
 */
import { listSkinIds } from '../../core';

/** 返回当前月份建议皮肤 id（在可用皮肤里轮转）。 */
export function seasonalSkinId(now: Date = new Date()): string {
    const ids = listSkinIds();
    if (ids.length === 0) return 'classic';
    const month = now.getMonth(); // 0..11
    return ids[month % ids.length];
}

/** 季节强调色（用于氛围/边框微调），按季返回 RGB。 */
export function seasonalAccent(now: Date = new Date()): [number, number, number] {
    const m = now.getMonth();
    if (m <= 1 || m === 11) return [150, 200, 255]; // 冬：冷蓝
    if (m <= 4) return [150, 230, 170];             // 春：嫩绿
    if (m <= 7) return [255, 210, 120];             // 夏：暖阳
    return [230, 160, 110];                          // 秋：橙褐
}
