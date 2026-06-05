/**
 * 玩法模式定义（Phase P1）。出块/消行/计分共享同一引擎，模式只改「失败规则 + 时间 + 计分倍率」。
 *   - classic   : 标准无尽，无可落点即失败
 *   - zen       : 不会失败（无可落点时软重排），放松摆放
 *   - lightning : 60 秒限时冲分，时间到即结束，连击加成更高
 */
import { GameMode } from './types';

export interface ModeDef {
    id: GameMode;
    nameKey: string;
    descKey: string;
    /** 是否允许失败（false = zen 软重排） */
    canFail: boolean;
    /** 限时（秒），0 = 无限时 */
    timeLimitSec: number;
    /** 分数倍率 */
    scoreMul: number;
}

export const MODES: Record<GameMode, ModeDef> = {
    classic: { id: 'classic', nameKey: 'mode.classic', descKey: 'mode.classic.desc', canFail: true, timeLimitSec: 0, scoreMul: 1 },
    zen: { id: 'zen', nameKey: 'mode.zen', descKey: 'mode.zen.desc', canFail: false, timeLimitSec: 0, scoreMul: 1 },
    lightning: { id: 'lightning', nameKey: 'mode.lightning', descKey: 'mode.lightning.desc', canFail: true, timeLimitSec: 60, scoreMul: 2 },
};

export const MODE_ORDER: GameMode[] = ['classic', 'zen', 'lightning'];

export function getMode(id: GameMode): ModeDef {
    return MODES[id] || MODES.classic;
}
