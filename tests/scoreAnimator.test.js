/**
 * scoreAnimator — 实时 HUD 分数滚动 + 强化反馈单测。
 *
 * 覆盖 v1.46「落子得分滚动 + 按 delta 分档脉冲 + 飘字 +N」的关键决策点：
 *   - hudBurstTier：delta=0/负 → null；小/中/大 delta → 不同 tier
 *   - hudDurationFor：随 delta 增长但有上限（+5 与 +500 不悬殊到拖沓）
 *   - animateHudScoreChange：delta=0 直接写入；delta>0 落 burst class + 飘字 DOM
 *   - 重复触发不归零，沿用上一帧的中间值作为新起点
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    hudBurstTier,
    hudDurationFor,
    animateHudScoreChange,
    animateValueOnElement,
    syncHudScoreElement,
    resetScoreWidthReservation,
    _selectHighScoreCheerType,
} from '../web/src/scoreAnimator.js';

describe('hudBurstTier', () => {
    it('delta=0 / 负值 → null（不触发 burst）', () => {
        expect(hudBurstTier(0)).toBeNull();
        expect(hudBurstTier(-5)).toBeNull();
        expect(hudBurstTier(-100)).toBeNull();
    });

    it('NaN / ±Infinity → null（防御性，避免被无效信号触发）', () => {
        expect(hudBurstTier(NaN)).toBeNull();
        expect(hudBurstTier(Infinity)).toBeNull();
        expect(hudBurstTier(-Infinity)).toBeNull();
    });

    it('1 ≤ delta < 20 → small（落子触发的小消除）', () => {
        expect(hudBurstTier(1)).toBe('small');
        expect(hudBurstTier(5)).toBe('small');
        expect(hudBurstTier(19)).toBe('small');
    });

    it('20 ≤ delta < 80 → medium（双消 / 多消）', () => {
        expect(hudBurstTier(20)).toBe('medium');
        expect(hudBurstTier(40)).toBe('medium');
        expect(hudBurstTier(79)).toBe('medium');
    });

    it('delta ≥ 80 → large（combo / perfect clear / 大 bonus）', () => {
        expect(hudBurstTier(80)).toBe('large');
        expect(hudBurstTier(200)).toBe('large');
        expect(hudBurstTier(10000)).toBe('large');
    });
});

describe('hudDurationFor', () => {
    it('delta ≤ 0 时为基础时长（不为负数 / NaN）', () => {
        expect(hudDurationFor(0)).toBeGreaterThan(0);
        expect(hudDurationFor(-1)).toBeGreaterThan(0);
    });

    it('随 delta 单调非降', () => {
        const samples = [1, 5, 10, 50, 100, 500, 1000].map(hudDurationFor);
        for (let i = 1; i < samples.length; i++) {
            expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
        }
    });

    it('上限受 durationMax 钳制（+10000 也不会到 2s+）', () => {
        const huge = hudDurationFor(100000);
        expect(huge).toBeLessThanOrEqual(1200);
    });

    it('小 delta 不应拖沓（+5 在 700ms 以内，足够看清也不挡视线）', () => {
        expect(hudDurationFor(5)).toBeLessThan(700);
    });

    it('大 delta 时长明显大于小 delta（+200 至少比 +5 长 50%）', () => {
        const small = hudDurationFor(5);
        const large = hudDurationFor(200);
        expect(large).toBeGreaterThan(small * 1.5);
    });
});

describe('animateHudScoreChange (DOM 副作用)', () => {
    let el;
    beforeEach(() => {
        el = document.createElement('div');
        el.id = 'score';
        document.body.appendChild(el);
        document.querySelectorAll('.score-float-delta').forEach((n) => n.remove());
        document.querySelectorAll('#score').forEach((n) => { if (n !== el) n.remove(); });
        // jsdom 下 getBoundingClientRect 默认全 0 → 飘字函数会早退；模拟一个真实可视尺寸
        el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 60, height: 30, right: 160, bottom: 80, x: 100, y: 50 });
    });

    it('delta=0 时直接写入新值，不挂 burst class、不生成飘字', () => {
        el.textContent = '100';
        animateHudScoreChange(el, 100, 100);
        expect(el.textContent).toBe('100');
        expect(el.className).toBe('');
        expect(document.querySelectorAll('.score-float-delta').length).toBe(0);
    });

    it('delta<0（撤销 / 重置）时直接写入新值，不做反向滚动', () => {
        el.textContent = '500';
        animateHudScoreChange(el, 200, 500);
        expect(el.textContent).toContain('200');
        expect(document.querySelectorAll('.score-float-delta').length).toBe(0);
    });

    it('delta>0 触发 small burst：挂上 score-burst--small class + 一个飘字节点', () => {
        el.textContent = '0';
        animateHudScoreChange(el, 5, 0);
        expect(el.classList.contains('score-burst')).toBe(true);
        expect(el.classList.contains('score-burst--small')).toBe(true);
        const floats = document.querySelectorAll('.score-float-delta--small');
        expect(floats.length).toBe(1);
        expect(floats[0].textContent).toBe('+5');
    });

    it('delta=100 触发 large burst + large 飘字（黄色金色）', () => {
        animateHudScoreChange(el, 100, 0);
        expect(el.classList.contains('score-burst--large')).toBe(true);
        const floats = document.querySelectorAll('.score-float-delta--large');
        expect(floats.length).toBe(1);
        expect(floats[0].textContent).toBe('+100');
    });

    it('连续触发：第二次的飘字独立生成（不复用同一个节点）', () => {
        animateHudScoreChange(el, 10, 0);
        animateHudScoreChange(el, 30, 10);
        const floats = document.querySelectorAll('.score-float-delta');
        expect(floats.length).toBe(2);
        expect(floats[0].textContent).toBe('+10');
        expect(floats[1].textContent).toBe('+20');
    });

    it('从 textContent 解析旧值（未传 oldValue 时）', () => {
        el.textContent = '42';
        animateHudScoreChange(el, 50);   // 不传 oldValue
        // delta = 50 - 42 = 8 → small
        expect(el.classList.contains('score-burst--small')).toBe(true);
        const floats = document.querySelectorAll('.score-float-delta');
        expect(floats[0].textContent).toBe('+8');
    });
});

/* ============================================================================
 * v1.61 抗抖动：滚动期间预留 #score 宽度，避免位数 / 千分位逗号逐帧变化导致
 *   居中 HUD 行反复重新居中（"多消特效+分数动效，偶发屏幕抖动"）。
 * ========================================================================== */
describe('v1.61 分数滚动宽度预留（抗 HUD 抖动）', () => {
    let el;
    beforeEach(() => {
        el = document.createElement('div');
        el.id = 'score';
        document.body.appendChild(el);
        document.querySelectorAll('.score-float-delta').forEach((n) => n.remove());
        document.querySelectorAll('#score').forEach((n) => { if (n !== el) n.remove(); });
        // 用"宽度 ∝ 当前文本字符数"的桩，模拟真实排版下数字越长越宽。
        el.getBoundingClientRect = () => ({
            left: 100, top: 50, height: 30, right: 160, bottom: 80, x: 100, y: 50,
            width: (el.textContent || '').length * 12,
        });
    });

    // 与 _formatNumber 同口径推导期望宽度（千分位受运行环境 locale 影响，故动态计算）。
    const expectPx = (n) => `${Math.floor(n).toLocaleString().length * 12}px`;

    it('滚动开始时按目标值宽度预留 min-width（中间值不再回缩）', () => {
        el.textContent = '90';
        animateHudScoreChange(el, 1280, 90);
        expect(el.style.minWidth).toBe(expectPx(1280));
    });

    it('预留单调递增：分数继续增长时取更大宽度', () => {
        el.textContent = '0';
        animateHudScoreChange(el, 1280, 0);
        expect(el.style.minWidth).toBe(expectPx(1280));
        animateHudScoreChange(el, 1500000, 1280);
        expect(el.style.minWidth).toBe(expectPx(1500000));
    });

    it('预留不回缩：后续较小目标仍保持已有的更大预留', () => {
        el.textContent = '0';
        animateHudScoreChange(el, 1500000, 0);
        const wide = expectPx(1500000);
        expect(el.style.minWidth).toBe(wide);
        // 位数相同的小幅增长不会改变预留宽度
        animateHudScoreChange(el, 1500050, 1500000);
        expect(el.style.minWidth).toBe(wide);
    });

    it('重开局（init 分支）复位宽度预留，避免上一局高分永久撑宽', () => {
        el.textContent = '0';
        animateHudScoreChange(el, 1280, 0);
        expect(el.style.minWidth).toBe(expectPx(1280));
        // 新一局首帧：lastDisplayedScore == null → init → 复位
        const branch = syncHudScoreElement(el, 0, null);
        expect(branch).toBe('init');
        expect(el.style.minWidth).toBe('');
        expect(el._reservedScoreW).toBe(0);
    });

    it('resetScoreWidthReservation 显式复位（防御性）', () => {
        el.textContent = '0';
        animateHudScoreChange(el, 999, 0);
        expect(el.style.minWidth).not.toBe('');
        resetScoreWidthReservation(el);
        expect(el.style.minWidth).toBe('');
        expect(el._reservedScoreW).toBe(0);
    });

    it('无真实排版（getBoundingClientRect 宽度为 0）时不设 min-width，不影响逻辑', () => {
        el.getBoundingClientRect = () => ({
            left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0,
        });
        el.textContent = '0';
        animateHudScoreChange(el, 500, 0);
        expect(el.style.minWidth).toBe('');
    });
});

describe('animateValueOnElement (通用滚动 — handle 行为)', () => {
    it('cancel() 应让后续帧不再写 textContent（用于"组件卸载/打断"路径）', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        el.textContent = '0';
        const handle = animateValueOnElement(el, 1000, { duration: 200 });
        expect(typeof handle.cancel).toBe('function');
        handle.cancel();
        expect(el.textContent).toBe('0');   // RAF 尚未跑就被取消
    });

    it('返回 handle 即使 element 为 null 也不抛错（防御性）', () => {
        expect(() => animateValueOnElement(null, 100)).not.toThrow();
        const h = animateValueOnElement(undefined, 100);
        expect(typeof h.cancel).toBe('function');
    });
});

/* ============================================================================
 * v1.49.x — syncHudScoreElement 决策表（"回放时得分未同步更新"修复）
 *
 * 旧实现把 `if/else if` 拼在 game.updateUI 里，回放跳帧 / RL 同步路径会先把
 *   _lastDisplayedScore 与 score 同时设为目标值（用于压制滚动 / +N 飘字），
 *   再调 updateUI()——两路（== null / !==）都进不去，DOM 永远停在旧值。
 * 抽取为 syncHudScoreElement 后，新增 'sync' 兜底分支：当 textContent 与
 *   目标值不一致时直接写入（无动画，符合"瞬移"语义）。
 * 本块覆盖 5 种分支（init / animate / sync / noop / no-element）。
 * ============================================================================ */

describe('syncHudScoreElement — 回放/RL 瞬移分数 DOM 同步决策器（v1.49.x）', () => {
    let el;
    beforeEach(() => {
        el = document.createElement('div');
        el.id = 'score';
        document.body.appendChild(el);
        document.querySelectorAll('.score-float-delta').forEach((n) => n.remove());
        document.querySelectorAll('#score').forEach((n) => { if (n !== el) n.remove(); });
        // 飘字函数依赖 getBoundingClientRect 提供真实尺寸
        el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 60, height: 30, right: 160, bottom: 80, x: 100, y: 50 });
    });

    it('element 为 null/undefined → 返回 "no-element" 不抛错', () => {
        expect(syncHudScoreElement(null, 100, 50)).toBe('no-element');
        expect(syncHudScoreElement(undefined, 100, 50)).toBe('no-element');
    });

    it('lastDisplayedScore == null（重开局首帧）→ "init" + 直接 textContent 写入，无动画 / 无飘字', () => {
        el.textContent = '0';
        const branch = syncHudScoreElement(el, 0, null);
        expect(branch).toBe('init');
        expect(el.textContent).toBe('0');
        expect(el.classList.contains('score-burst')).toBe(false);
        expect(document.querySelectorAll('.score-float-delta').length).toBe(0);
    });

    it('lastDisplayedScore !== score（实机加分）→ "animate" + 触发滚动 + +N 飘字', () => {
        el.textContent = '100';
        const branch = syncHudScoreElement(el, 105, 100);
        expect(branch).toBe('animate');
        expect(el.classList.contains('score-burst')).toBe(true);
        const floats = document.querySelectorAll('.score-float-delta');
        expect(floats.length).toBe(1);
        expect(floats[0].textContent).toBe('+5');
    });

    it('回放跳帧（last == score 但 DOM 文本陈旧）→ "sync" + 直接 textContent，无动画 / 无飘字', () => {
        // 模拟：上一局 HUD 停在 1280；进入回放，applyReplayFrameIndex(0) 把
        //   game.score = 0、game._lastDisplayedScore = 0，再调 updateUI()。
        // 旧 bug：DOM 仍是 '1280'；新逻辑应写为 '0'。
        el.textContent = '1280';
        const branch = syncHudScoreElement(el, 0, 0);
        expect(branch).toBe('sync');
        expect(el.textContent).toBe('0');
        // "瞬移"语义：不应触发任何 burst / 飘字
        expect(el.classList.contains('score-burst')).toBe(false);
        expect(document.querySelectorAll('.score-float-delta').length).toBe(0);
    });

    it('回放滑块连续拖动多帧（last == score 中间不同步）→ 每次都进 "sync"，DOM 跟随当前帧', () => {
        el.textContent = '0';
        // 拖到帧 N，分数 = 240
        expect(syncHudScoreElement(el, 240, 240)).toBe('sync');
        expect(el.textContent).toBe('240');
        // 再拖到帧 M，分数 = 1280
        expect(syncHudScoreElement(el, 1280, 1280)).toBe('sync');
        expect(el.textContent).toBe('1280');
        // 倒退到帧 K，分数 = 60
        expect(syncHudScoreElement(el, 60, 60)).toBe('sync');
        expect(el.textContent).toBe('60');
        // 全程不应触发滚动 burst / 飘字
        expect(el.classList.contains('score-burst')).toBe(false);
        expect(document.querySelectorAll('.score-float-delta').length).toBe(0);
    });

    it('同值同 DOM（updateUI 反复调）→ "noop"，DOM 不写入，无副作用', () => {
        el.textContent = '500';
        const branch = syncHudScoreElement(el, 500, 500);
        expect(branch).toBe('noop');
        expect(el.textContent).toBe('500');
        expect(el.classList.contains('score-burst')).toBe(false);
    });

    it('RL syncFromSimulator（last == score 但 DOM 旧）→ "sync"，与回放路径同分支', () => {
        // RL 演示路径：模拟器 score=850，game._lastDisplayedScore = 850, game.score = 850
        // DOM 上一帧仍是 '420'；本函数必须把 DOM 写为 '850'
        el.textContent = '420';
        expect(syncHudScoreElement(el, 850, 850)).toBe('sync');
        expect(el.textContent).toBe('850');
    });

    it('回放进入瞬间分数恰好等于上一局 HUD（边界：DOM 已同步）→ "noop"', () => {
        // 极少数巧合：回放第 0 帧分数 = 上一局结束分数。两值与 DOM 都相等 → noop。
        el.textContent = '888';
        expect(syncHudScoreElement(el, 888, 888)).toBe('noop');
        expect(el.textContent).toBe('888');
    });
});

/**
 * v1.60.5：高分庆祝音效档位按"分数 / 历史 PB 占比"动态判定。
 * 与 BEST_SCORE_CHASE_STRATEGY §5.α D2/D3/D4 段保持一致；低 PB（< 200）回退到
 * 固定绝对阈值，避免 best=10 / 8 分（pct=0.8）触发"差一口气"虚假胜利。
 */
describe('v1.60.5 _selectHighScoreCheerType (按 pct=score/bestScore 选高分音效档位)', () => {
    /* ── 高 PB 段：按比例判档（best ≥ 200） ───────────────────────────── */
    it('破 PB（pct >= 1.0）→ unlock', () => {
        expect(_selectHighScoreCheerType(500, 500)).toBe('unlock');
        expect(_selectHighScoreCheerType(800, 500)).toBe('unlock');
        expect(_selectHighScoreCheerType(1200, 1000)).toBe('unlock');
    });

    it('差一口气段（0.85 ≤ pct < 1.0）→ perfect', () => {
        /* best=500, score=425 → pct=0.85 边界 */
        expect(_selectHighScoreCheerType(425, 500)).toBe('perfect');
        expect(_selectHighScoreCheerType(490, 500)).toBe('perfect');
        /* best=1000, score=950 */
        expect(_selectHighScoreCheerType(950, 1000)).toBe('perfect');
        /* 0.85 严格大于等于（边界包含） */
        expect(_selectHighScoreCheerType(170, 200)).toBe('perfect');
    });

    it('达成 PB 一半（0.5 ≤ pct < 0.85）→ clear', () => {
        /* best=500, score=250 → pct=0.5 边界 */
        expect(_selectHighScoreCheerType(250, 500)).toBe('clear');
        expect(_selectHighScoreCheerType(424, 500)).toBe('clear');
        expect(_selectHighScoreCheerType(700, 1000)).toBe('clear');
    });

    it('pct < 0.5 且 best 充足 → 静默（null）', () => {
        expect(_selectHighScoreCheerType(100, 500)).toBeNull();
        expect(_selectHighScoreCheerType(249, 500)).toBeNull();
        expect(_selectHighScoreCheerType(0, 500)).toBeNull();
    });

    /* ── 低 PB 守卫：best < 200 时回退到绝对阈值 ─────────────────────── */
    it('低 PB（best < 200，含首局 best=0）→ 回退绝对阈值，避免虚假胜利', () => {
        /* best=10, score=8（pct=0.8 即使在新口径下也会被错误识别为"差一口气"）
         * 但低 PB 守卫强制回退到绝对阈值：score=8 < 200 → null（静默） */
        expect(_selectHighScoreCheerType(8, 10)).toBeNull();
        /* best=100, score=80（pct=0.8）→ 同样静默 */
        expect(_selectHighScoreCheerType(80, 100)).toBeNull();
        /* best=0 首局 → 完全走绝对阈值 */
        expect(_selectHighScoreCheerType(150, 0)).toBeNull();
        expect(_selectHighScoreCheerType(200, 0)).toBe('clear');
        expect(_selectHighScoreCheerType(500, 0)).toBe('perfect');
        expect(_selectHighScoreCheerType(1000, 0)).toBe('unlock');
        /* best=150（低 PB）+ score=800 → 走绝对阈值 → perfect */
        expect(_selectHighScoreCheerType(800, 150)).toBe('perfect');
    });

    /* ── 防御性输入 ───────────────────────────────────────────────────── */
    it('NaN / undefined / null bestScore → 视为 0，走绝对阈值', () => {
        expect(_selectHighScoreCheerType(300, undefined)).toBe('clear');
        expect(_selectHighScoreCheerType(300, null)).toBe('clear');
        expect(_selectHighScoreCheerType(300, NaN)).toBe('clear');
    });

    it('floor 选项可覆写（便于 A/B 测试调整低 PB 阈值）', () => {
        /* 把 floor 提到 1000：best=500 也回退到绝对阈值 */
        expect(_selectHighScoreCheerType(500, 500, { floor: 1000 })).toBe('perfect');
        /* best=1500 仍按比例：pct=0.5 → clear */
        expect(_selectHighScoreCheerType(750, 1500, { floor: 1000 })).toBe('clear');
    });

    it('档位选择避免"过度反馈"——pct < 0.5 静默而非 small 庆祝', () => {
        /* 与"差一口气"banner §5.α.6 同设计：低于半 PB 不触发任何庆祝音 */
        for (const pct of [0.0, 0.1, 0.3, 0.49]) {
            const score = Math.round(1000 * pct);
            expect(_selectHighScoreCheerType(score, 1000)).toBeNull();
        }
    });
});
