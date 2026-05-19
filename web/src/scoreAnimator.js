/**
 * scoreAnimator.js — 分数滚动动画与强化效果
 *
 * 职责：
 * 1. 游戏结束结算（`#over-score`）：从 0 滚到最终分数 + 粒子庆祝（既有 API 保留向后兼容）
 * 2. 实时 HUD（`#score`，v1.46 起）：每次 score 变化时从旧值滚到新值，叠加按 delta 分档
 *    的强化反馈（脉冲 / 上浮 / 高亮 / 金色），让玩家清楚感知到分数变化
 *
 * 设计要点：
 * - 滚动期间被新一轮打断时，用"当前正在显示的中间值"作为新起点（不重置归零），保证连消时
 *   分数曲线连续不抖
 * - reduced-motion 用户：直接跳到目标值并发轻量 reinforce（避免运动眩晕）
 * - 每个元素独立 RAF 句柄，彼此不串扰；通用 `animateValueOnElement` 可被其他指标复用
 */

const SCORE_ANIMATION_CONFIG = {
    duration: 1500,
    easing: 'easeOutExpo',
    chunkSize: 50,
    reinforceScale: 1.15,
    reinforceDuration: 200
};

/** 实时 HUD 滚动配置（v1.46.1：根据玩家反馈延长时长，让滚动更可感知） */
const HUD_SCORE_CONFIG = {
    /** 每次 delta 的滚动总时长（ms）；与 delta 成对数关系，确保 +5 与 +500 都既能看清又不拖沓 */
    durationBase: 520,
    durationPerLog: 180,
    durationMax: 1200,
    /** 上浮飘字 +N 的距离（px）：v1.46.1 28→44，配合"飘字位于分数上方"减少对分数的遮挡 */
    floatRiseDistance: 44,
    /** 飘字与分数元素之间的初始留白（px），避免起手就压字。负值表示飘字在分数上方 */
    floatAnchorGapPx: 8,
    /** delta 分档触发的强化等级阈值 */
    burstThresholdSmall: 1,
    burstThresholdMedium: 20,
    burstThresholdLarge: 80,
};

let _scoreElement = null;
let _animationId = null;

/** 每个元素一份滚动状态（id → state），支持多个元素并行滚 */
const _elementStates = new WeakMap();

export function initScoreAnimator() {
    _scoreElement = document.getElementById('over-score');
    return _scoreElement !== null;
}

function _easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function _formatNumber(num) {
    return Math.floor(num).toLocaleString();
}

function _prefersReducedMotion() {
    try {
        return typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

/**
 * 通用：把一个元素的数值从 from 滚动到 to，每帧用 onFrame 更新 textContent。
 * 重复调用会接管旧动画的"当前帧值"作为新起点，避免归零回拨。
 *
 * @param {HTMLElement} element
 * @param {number}      to
 * @param {object}      [opts]
 * @param {number}      [opts.duration]   总时长（ms）
 * @param {(v:number)=>string} [opts.format]  数值 → 文本
 * @param {(v:number,t:number)=>void} [opts.onFrame]  每帧回调（v=当前值，t=进度 0..1）
 * @param {()=>void}    [opts.onComplete]
 * @returns {{ cancel:()=>void }}
 */
export function animateValueOnElement(element, to, opts = {}) {
    if (!element) {
        return { cancel: () => {} };
    }
    const duration = Math.max(1, Number(opts.duration) || 600);
    const format = typeof opts.format === 'function' ? opts.format : _formatNumber;
    const targetVal = Number(to) || 0;

    let prev = _elementStates.get(element);
    if (prev?.rafId != null) {
        cancelAnimationFrame(prev.rafId);
    }
    const parsedFromDom = Number(element.textContent.replace(/[^\d.-]/g, ''));
    const startVal = prev?.currentValue ?? (Number.isFinite(parsedFromDom) ? parsedFromDom : targetVal);
    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const state = {
        rafId: null,
        currentValue: startVal,
        target: targetVal,
        cancelled: false,
    };
    _elementStates.set(element, state);

    function step(now) {
        if (state.cancelled) return;
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = _easeOutExpo(progress);
        const v = startVal + (targetVal - startVal) * eased;
        state.currentValue = v;
        element.textContent = format(v);
        if (typeof opts.onFrame === 'function') opts.onFrame(v, progress);
        if (progress < 1) {
            state.rafId = requestAnimationFrame(step);
        } else {
            state.currentValue = targetVal;
            element.textContent = format(targetVal);
            state.rafId = null;
            if (typeof opts.onComplete === 'function') opts.onComplete();
        }
    }
    state.rafId = requestAnimationFrame(step);
    return {
        cancel: () => {
            state.cancelled = true;
            if (state.rafId != null) cancelAnimationFrame(state.rafId);
            state.rafId = null;
        },
    };
}

/* === HUD 实时滚动（v1.46 入口） ============================================== */

/**
 * 决定 delta 触发什么强化档位。null = 不强化（delta=0 / 减分 / 极小波动）。
 * @param {number} delta
 * @returns {'small'|'medium'|'large'|null}
 */
export function hudBurstTier(delta) {
    if (!Number.isFinite(delta) || delta < HUD_SCORE_CONFIG.burstThresholdSmall) return null;
    if (delta >= HUD_SCORE_CONFIG.burstThresholdLarge) return 'large';
    if (delta >= HUD_SCORE_CONFIG.burstThresholdMedium) return 'medium';
    return 'small';
}

/** 由 delta 大小自适应滚动时长——+5 短促、+500 也不会拖沓 1s+ */
export function hudDurationFor(delta) {
    const cfg = HUD_SCORE_CONFIG;
    if (delta <= 0) return cfg.durationBase;
    const log = Math.log10(delta + 1);
    return Math.min(cfg.durationMax, Math.round(cfg.durationBase + cfg.durationPerLog * log * log));
}

/**
 * HUD 实时分数滚动入口。每次 score 变化都调一下，本函数会：
 * - 自动跳过 delta=0
 * - reduced-motion 用户立即写入新值并发轻量 reinforce
 * - 否则启动 RAF 滚动 + delta 分档的脉冲 / 上浮飘字 / 高亮
 *
 * @param {HTMLElement} element  分数元素（如 #score）
 * @param {number}      newValue  目标分数
 * @param {number}      [oldValue]  当前显示分数（不传则从 textContent 解析）
 */
export function animateHudScoreChange(element, newValue, oldValue) {
    if (!element) return;
    const target = Number(newValue) || 0;
    const baseline = Number.isFinite(oldValue)
        ? Number(oldValue)
        : (Number(element.textContent.replace(/[^\d.-]/g, '')) || 0);
    const delta = target - baseline;
    if (delta === 0) {
        element.textContent = _formatNumber(target);
        return;
    }
    if (delta < 0) {
        // 减分（极少见，例如撤销）—— 直接写入，不做"倒滚"动画避免产生负反馈错觉
        element.textContent = _formatNumber(target);
        return;
    }

    const tier = hudBurstTier(delta);

    if (_prefersReducedMotion()) {
        element.textContent = _formatNumber(target);
        if (tier) _applyHudBurst(element, tier);
        _spawnFloatScoreText(element, delta, tier);
        return;
    }

    animateValueOnElement(element, target, {
        duration: hudDurationFor(delta),
    });

    if (tier) _applyHudBurst(element, tier);
    _spawnFloatScoreText(element, delta, tier);
}

/**
 * v1.49.x — HUD 分数 DOM 同步决策器（统一三类调用路径，杜绝"瞬移分数 DOM 不刷新"）。
 *
 * 三种入口、三种期望行为：
 *   1. 重开局首帧：`lastDisplayedScore == null` → 直接 textContent 写入（无动画）
 *   2. 实机加分：  `lastDisplayedScore !== score` → 走 animateHudScoreChange 滚动 + 飘字 + burst
 *   3. **瞬移同步**（回放跳帧 / RL 模拟器同步）：调用方为压制滚动会先把 lastDisplayedScore
 *      与 score 同时设为目标值；旧实现两路（== null / !==）都进不去 → DOM 永远停留在
 *      旧值（用户报告"回放时得分未同步更新"）。本函数兜底：当 textContent 与目标值
 *      不一致时直接写入（无动画，符合"瞬移"语义）。
 *   4. 同值同 DOM：noop（性能不变）。
 *
 * @param {HTMLElement|null} element  分数元素（如 `#score`）
 * @param {number}           score    目标分数
 * @param {number|null}      lastDisplayedScore  上次写入 DOM 的值
 * @returns {'no-element'|'init'|'animate'|'sync'|'noop'} 实际走的分支（便于日志/单测断言）
 */
export function syncHudScoreElement(element, score, lastDisplayedScore) {
    if (!element) return 'no-element';
    const targetText = String(score);
    if (lastDisplayedScore == null) {
        element.textContent = targetText;
        return 'init';
    }
    if (lastDisplayedScore !== score) {
        animateHudScoreChange(element, score, lastDisplayedScore);
        return 'animate';
    }
    if (element.textContent !== targetText) {
        element.textContent = targetText;
        return 'sync';
    }
    return 'noop';
}

const HUD_BURST_CLASS = {
    small: 'score-burst score-burst--small',
    medium: 'score-burst score-burst--medium',
    large: 'score-burst score-burst--large',
};
/* v1.46.1：根据玩家反馈延长，让 scale + 高亮脉冲与滚动时长相称、可看清 */
const HUD_BURST_DURATION = {
    small: 540,
    medium: 800,
    large: 1100,
};

/** 在 element 上叠加一个 CSS class，N ms 后自动移除（避免动画卡死） */
function _applyHudBurst(element, tier) {
    const classes = HUD_BURST_CLASS[tier];
    if (!classes) return;
    classes.split(' ').forEach((c) => element.classList.add(c));
    const ms = HUD_BURST_DURATION[tier] || 400;
    if (element._burstTimer) clearTimeout(element._burstTimer);
    element._burstTimer = setTimeout(() => {
        classes.split(' ').forEach((c) => element.classList.remove(c));
        element._burstTimer = null;
    }, ms);
}

/**
 * 在分数元素**上方**飘出 "+N" 字样，由 CSS keyframes 上浮淡出。
 *
 * v1.46.1：锚点从"分数中心"上移到"分数顶端再向上 floatAnchorGapPx"，并用 translateY(-100%)
 * 让飘字底部刚好对齐分数顶部 + 间隙，全程不与分数文字重叠，玩家始终看得到滚动中的分数。
 */
function _spawnFloatScoreText(anchorEl, delta, tier) {
    if (!anchorEl || !document?.body) return;
    const rect = anchorEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const node = document.createElement('div');
    node.className = `score-float-delta score-float-delta--${tier || 'small'}`;
    node.textContent = `+${Math.floor(delta).toLocaleString()}`;
    const anchorTop = rect.top - HUD_SCORE_CONFIG.floatAnchorGapPx;
    node.style.cssText = `
        position: fixed;
        left: ${rect.left + rect.width / 2}px;
        top: ${anchorTop}px;
        transform: translate(-50%, -100%);
        pointer-events: none;
        z-index: 9998;
        --float-rise: -${HUD_SCORE_CONFIG.floatRiseDistance}px;
    `;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 1300);
}

/* === 既有：游戏结束页 0→target 滚动（向后兼容） ============================== */

export function animateScore(targetScore, options = {}) {
    if (!_scoreElement) {
        initScoreAnimator();
    }

    if (!_scoreElement) {
        console.warn('[ScoreAnimator] Score element not found');
        return Promise.resolve();
    }

    const config = { ...SCORE_ANIMATION_CONFIG, ...options };
    const startTime = performance.now();
    const startScore = 0;

    if (_animationId) {
        cancelAnimationFrame(_animationId);
    }

    return new Promise((resolve) => {
        function _animate(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / config.duration, 1);
            const easedProgress = _easeOutExpo(progress);

            const currentScore = startScore + (targetScore - startScore) * easedProgress;
            _scoreElement.textContent = _formatNumber(currentScore);

            const scale = 1 + (config.reinforceScale - 1) * Math.sin(progress * Math.PI);
            _scoreElement.style.transform = `scale(${scale})`;

            if (progress < 1) {
                _animationId = requestAnimationFrame(_animate);
            } else {
                _scoreElement.textContent = _formatNumber(targetScore);
                _scoreElement.style.transform = '';
                _triggerFinalReinforce(targetScore);
                _animationId = null;
                resolve();
            }
        }

        _animationId = requestAnimationFrame(_animate);
    });
}

function _triggerFinalReinforce(score) {
    if (!_scoreElement) return;

    _scoreElement.classList.add('score-final-reinforce');

    const particles = _createScoreParticles(score);
    particles.forEach(p => document.body.appendChild(p));

    setTimeout(() => {
        _scoreElement.classList.remove('score-final-reinforce');
        particles.forEach(p => p.remove());
    }, 600);
}

function _createScoreParticles(score) {
    const particles = [];
    const isHighScore = score >= 1000;
    const count = isHighScore ? 12 : 6;

    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'score-particle';
        particle.textContent = ['✨', '⭐', '💫', '🌟'][i % 4];

        const rect = _scoreElement.getBoundingClientRect();
        const startX = rect.left + rect.width / 2;
        const startY = rect.top + rect.height / 2;

        const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
        const distance = 80 + Math.random() * 60;
        const endX = startX + Math.cos(angle) * distance;
        const endY = startY + Math.sin(angle) * distance - 40;

        particle.style.cssText = `
            position: fixed;
            left: ${startX}px;
            top: ${startY}px;
            font-size: 24px;
            pointer-events: none;
            z-index: 9999;
            animation: scoreParticleFly 0.8s ease-out forwards;
            --end-x: ${endX}px;
            --end-y: ${endY}px;
        `;

        particles.push(particle);
    }

    return particles;
}

export function stopScoreAnimation() {
    if (_animationId) {
        cancelAnimationFrame(_animationId);
        _animationId = null;
    }
}

/* === v1.60.3 老虎机式按位滚动 ============================================
 * 结算页（#over-score）专用入场动画：把数字拆成 N 个独立的"位"，每位都从
 * 0 一路滚到目标数字（多滚 N 圈营造翻牌感），高位先停、低位后停，整体动画
 * 完成时触发既有的 _triggerFinalReinforce 粒子庆祝。
 *
 * 与 animateScore（纯 textContent 递增 + scale 弹跳）的视觉差异：
 *   - 每位数都"看得见地在翻"，比单纯计数更"赢钱感"
 *   - 千位分隔符（"1,287"）作为静态字符夹在数位之间，不滚
 *   - reduced-motion 直接落到末位、跳过翻滚（保留粒子庆祝）
 *
 * v1.60.4（用户反馈）：得分是结算页的主信息，节奏放慢、让玩家"凝视" — duration
 *   1500→2200ms，digitStaggerMs 160→240ms；同时按分数档位通过 window.__audioFx
 *   播声（共享 audioFx.prefs.sound 全局开关，未启用音效或浏览器不支持均静默）。
 *
 * v1.60.5：档位从"固定绝对阈值"改为"按 bestScore 占比的动态阈值"——与
 *   BEST_SCORE_CHASE_STRATEGY §5.α 的"差一口气"banner 同哲学，对低水位玩家
 *   不再永远听不到任何音效，对高水位玩家不再听到"小题大做"的庆祝。具体见
 *   `_playHighScoreCheer` 内的档位说明。调用方需在 options 透传 bestScore。
 *
 * DOM 结构示例（420）：
 *   <span class="odo-digit"><span class="odo-strip">…0…9 重复 N 圈 + <i>4</i></span></span>
 *   <span class="odo-digit">…<i>2</i></span>
 *   <span class="odo-digit">…<i>0</i></span>
 */
export function animateScoreOdometer(targetScore, options = {}) {
    if (!_scoreElement) initScoreAnimator();
    if (!_scoreElement) return Promise.resolve();

    const cfg = {
        duration: 2200,
        digitStaggerMs: 240,
        spinExtraTurns: 2,
        /* v1.60.5：调用方应透传"本局开始前的历史 PB"（与 game.js 的
         * persistedBestBase = _bestScoreAtRunStart ?? bestScore 一致）——
         * 用 run-start 时的 PB 而非可能已被本局更新的 this.bestScore，
         * 避免 pct 永远等于 1.0 的循环引用。 */
        bestScore: 0,
        ...options,
    };
    const total = Math.max(0, Math.floor(Number(targetScore) || 0));
    const text = total.toLocaleString();

    _scoreElement.innerHTML = '';
    _scoreElement.classList.add('odo-host');

    const slots = [];
    for (const ch of text) {
        if (/\d/.test(ch)) {
            const digit = Number(ch);
            const slot = document.createElement('span');
            slot.className = 'odo-digit';
            const strip = document.createElement('span');
            strip.className = 'odo-strip';
            const totalCycles = cfg.spinExtraTurns + 1;
            const cycle = Array.from({ length: 10 }, (_, i) => `<i>${i}</i>`).join('');
            strip.innerHTML = cycle.repeat(totalCycles) + `<i>${digit}</i>`;
            slot.appendChild(strip);
            _scoreElement.appendChild(slot);
            slots.push({ stripEl: strip, finalDigit: digit, totalCycles });
        } else {
            const sep = document.createElement('span');
            sep.className = 'odo-sep';
            sep.textContent = ch;
            _scoreElement.appendChild(sep);
        }
    }

    if (_prefersReducedMotion()) {
        slots.forEach((s) => {
            const targetRow = s.totalCycles * 10;
            s.stripEl.style.transition = 'none';
            s.stripEl.style.transform = `translateY(-${targetRow}em)`;
        });
        _triggerFinalReinforce(total);
        _playHighScoreCheer(total, cfg.bestScore);
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            slots.forEach((s, idx) => {
                const targetRow = s.totalCycles * 10;
                const delay = idx * cfg.digitStaggerMs;
                /* 高位略快、低位略慢，强化"翻牌停在最后一位"的节奏 */
                const slotDuration = Math.max(420, cfg.duration - idx * cfg.digitStaggerMs * 0.3);
                s.stripEl.style.transition =
                    `transform ${slotDuration}ms cubic-bezier(.18,.7,.18,1) ${delay}ms`;
                s.stripEl.style.transform = `translateY(-${targetRow}em)`;
            });
        });
        /* 最后一个位完成的时间作为最终庆祝触发点 */
        const finishMs = cfg.duration + Math.max(0, slots.length - 1) * cfg.digitStaggerMs + 60;
        setTimeout(() => {
            _triggerFinalReinforce(total);
            _playHighScoreCheer(total, cfg.bestScore);
            resolve();
        }, finishMs);
    });
}

/**
 * v1.60.5：按"分数 / 历史 PB 占比"动态选择高分庆祝音效档位。
 *
 * 通过 `window.__audioFx`（audioFx.js 启动期已挂载的单例）调用 `.play(type)`，
 * audioFx 内部统一检查 `this.prefs.sound`——也就是说**完全共享全局音效开关**：
 * 用户在设置里关掉音效，这里也自动静默；浏览器不支持 WebAudio 同样静默。
 *
 * 档位映射（与 BEST_SCORE_CHASE_STRATEGY §5.α 的 D2/D3/D4 段对齐）：
 *   - pct ≥ 1.00 (D4 破/平 PB)         → 'unlock'（上行胜利感双音叠加）
 *   - pct ≥ 0.85 (D2/D3 差一口气段)    → 'perfect'（成就级 jingle）
 *   - pct ≥ 0.50 (达成 PB 一半)        → 'clear'（轻量庆祝，与消行同色）
 *   - 其他                             → 静默
 *
 * 低 PB 守卫：bestScore < HIGH_SCORE_FLOOR (200) 时（含首局 best=0）回退到固定
 * 绝对阈值，避免 best=10 打到 8 分（pct=0.8）触发"差一口气"音效的虚假胜利
 * ——与 `_isLowBestForIntenseCopy()` 在 §5.α.6 的低 PB 文案守卫哲学一致。
 *
 * @param {number} score      本局最终分数
 * @param {number} bestScore  本局开始前的历史 PB（persistedBestBase）
 */
function _playHighScoreCheer(score, bestScore) {
    if (typeof window === 'undefined') return;
    const fx = window.__audioFx;
    if (!fx || typeof fx.play !== 'function') return;
    const type = _selectHighScoreCheerType(score, bestScore);
    if (!type) return;
    try { fx.play(type, { force: true }); } catch { /* 忽略音频路径异常 */ }
}

/**
 * v1.60.5（导出供单测覆盖各档位边界）：按"分数 / 历史 PB 占比"选档位的纯函数。
 *
 * @param {number} score
 * @param {number} bestScore
 * @param {{ floor?: number }} [opts]   测试可覆写 HIGH_SCORE_FLOOR
 * @returns {'unlock'|'perfect'|'clear'|null}
 */
export function _selectHighScoreCheerType(score, bestScore, opts) {
    const HIGH_SCORE_FLOOR = Number(opts?.floor) > 0 ? Number(opts.floor) : 200;
    const best = Number(bestScore) || 0;
    const s = Number(score) || 0;
    if (best >= HIGH_SCORE_FLOOR) {
        const pct = s / best;
        if (pct >= 1.0) return 'unlock';
        if (pct >= 0.85) return 'perfect';
        if (pct >= 0.5) return 'clear';
        return null;
    }
    /* 低 PB 段（含首局 best=0）：回退到绝对阈值 */
    if (s >= 1000) return 'unlock';
    if (s >= 500) return 'perfect';
    if (s >= 200) return 'clear';
    return null;
}

export function setScoreImmediate(score) {
    if (!_scoreElement) {
        initScoreAnimator();
    }
    if (_scoreElement) {
        _scoreElement.textContent = _formatNumber(score);
    }
}

if (typeof document !== 'undefined' && !document.getElementById('score-particle-styles')) {
    const style = document.createElement('style');
    style.id = 'score-particle-styles';
    style.textContent = `
        @keyframes scoreParticleFly {
            0% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(0.5);
            }
            50% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1.2);
            }
            100% {
                opacity: 0;
                transform: translate(calc(-50% + var(--end-x) - var(--start-x, 0px)), calc(-50% + var(--end-y))) scale(0.3);
            }
        }
        .score-final-reinforce {
            animation: scoreReinforce 0.6s ease-out;
        }
        @keyframes scoreReinforce {
            0% { transform: scale(1); filter: brightness(1); }
            30% { transform: scale(1.2); filter: brightness(1.3); }
            60% { transform: scale(1.1); filter: brightness(1.1); }
            100% { transform: scale(1); filter: brightness(1); }
        }

        /* v1.46 实时 HUD 分数强化（按 delta 分档） */
        .score-burst {
            display: inline-block;
            transform-origin: center;
            will-change: transform, filter;
        }
        .score-burst--small {
            animation: scoreBurstSmall 540ms cubic-bezier(.2,.7,.2,1) both;
        }
        .score-burst--medium {
            animation: scoreBurstMedium 800ms cubic-bezier(.2,.7,.2,1) both;
        }
        .score-burst--large {
            animation: scoreBurstLarge 1100ms cubic-bezier(.2,.7,.2,1) both;
        }
        @keyframes scoreBurstSmall {
            0%   { transform: scale(1);    filter: brightness(1); }
            35%  { transform: scale(1.12); filter: brightness(1.2); }
            100% { transform: scale(1);    filter: brightness(1); }
        }
        @keyframes scoreBurstMedium {
            0%   { transform: scale(1);    filter: brightness(1)   drop-shadow(0 0 0 transparent); }
            30%  { transform: scale(1.22); filter: brightness(1.35) drop-shadow(0 0 8px rgba(56,189,248,.55)); }
            70%  { transform: scale(1.05); filter: brightness(1.15) drop-shadow(0 0 4px rgba(56,189,248,.30)); }
            100% { transform: scale(1);    filter: brightness(1)   drop-shadow(0 0 0 transparent); }
        }
        @keyframes scoreBurstLarge {
            0%   { transform: scale(1);    filter: brightness(1)   drop-shadow(0 0 0 transparent); color: inherit; }
            25%  { transform: scale(1.32); filter: brightness(1.5) drop-shadow(0 0 14px rgba(250,204,21,.85)); color: #fde047; }
            55%  { transform: scale(1.10); filter: brightness(1.25) drop-shadow(0 0 8px rgba(250,204,21,.55));  color: #fde047; }
            85%  { transform: scale(1.04); filter: brightness(1.10) drop-shadow(0 0 4px rgba(250,204,21,.30));  color: inherit; }
            100% { transform: scale(1);    filter: brightness(1)   drop-shadow(0 0 0 transparent); color: inherit; }
        }

        /* v1.46 飘字 +N（HUD 上方）
         * v1.46.1：锚点已移到分数顶端（translate(-50%, -100%) 让飘字底部对齐分数顶端）
         * 故 keyframes 用 translateY(-100% + …) 起始，向上"再"飘 var(--float-rise) 距离，
         * 全程不与分数重叠，玩家可以同时看到滚动中的分数与飘字。 */
        .score-float-delta {
            font-family: 'Bebas Neue', 'Oswald', 'Impact', sans-serif;
            font-weight: 900;
            color: #fde047;
            text-shadow:
                0 1px 0 rgba(0,0,0,.45),
                0 0 6px rgba(250,204,21,.55);
            animation: scoreFloatRise 1300ms cubic-bezier(.25,.1,.2,1) forwards;
            white-space: nowrap;
        }
        .score-float-delta--small  { font-size: 18px; }
        .score-float-delta--medium { font-size: 24px; }
        .score-float-delta--large  { font-size: 32px; color: #fbbf24; }
        @keyframes scoreFloatRise {
            0%   { opacity: 0; transform: translate(-50%, -100%) scale(0.6); }
            15%  { opacity: 1; transform: translate(-50%, -100%) scale(1.05); }
            70%  { opacity: 1; transform: translate(-50%, calc(-100% + var(--float-rise) * 0.7)) scale(1); }
            100% { opacity: 0; transform: translate(-50%, calc(-100% + var(--float-rise))) scale(0.95); }
        }

        @media (prefers-reduced-motion: reduce) {
            .score-burst--small,
            .score-burst--medium,
            .score-burst--large { animation-duration: 1ms; }
            .score-float-delta { animation-duration: 320ms; }
        }

        /* === v1.60.3 老虎机式按位滚动（#over-score 专用） ===
         * 父元素 .game-over-score 已用 background-clip:text 实现渐变文字色；
         * 子节点 .odo-digit/.odo-sep 必须自带同款渐变 + transparent fill 才能
         * 让翻滚中的每个数字也是橙色渐变（否则会因 overflow:hidden 裁切丢色）。
         * 高度严格锁定到 1em + overflow:hidden 构造"窥孔"，strip 在垂直滚动。
         */
        .game-over-score.odo-host {
            display: inline-flex;
            align-items: baseline;
            justify-content: center;
            line-height: 1;
            /* odometer 模式下父元素不再直接渲染字符，背景渐变下放到子节点；
             * 父级保留 background 以便 :hover 等场景复用，子节点用 inherit */
        }
        .game-over-score.odo-host .odo-digit,
        .game-over-score.odo-host .odo-sep {
            display: inline-block;
            line-height: 1;
            vertical-align: top;
            font-variant-numeric: tabular-nums;
            background: inherit;
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            color: transparent;
        }
        .game-over-score.odo-host .odo-digit {
            height: 1em;
            overflow: hidden;
            min-width: 0.62em;
            text-align: center;
        }
        .game-over-score.odo-host .odo-strip {
            display: flex;
            flex-direction: column;
            transform: translateY(0);
            will-change: transform;
            background: inherit;
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            color: transparent;
        }
        .game-over-score.odo-host .odo-strip > i {
            height: 1em;
            line-height: 1;
            display: block;
            font-style: normal;
            text-align: center;
            font-variant-numeric: tabular-nums;
        }
    `;
    document.head.appendChild(style);
}
