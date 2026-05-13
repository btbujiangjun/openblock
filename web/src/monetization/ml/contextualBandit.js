/**
 * contextualBandit.js — LinUCB 上下文老虎机（Online learning scaffolding）
 *
 * v1.49.x 算法层 P3-1：
 *   把 adInsertionRL.js 的 selectAdInsertionAction（当前为规则版）升级为 LinUCB
 *   contextual bandit。LinUCB 是 Yahoo News 推荐论文（Li et al., 2010）首个引入
 *   工业级 contextual bandit 的算法，工业界（特别是广告系统）广泛使用。
 *
 * 核心思想：
 *   - 每个 action a 维护：
 *       A_a = D_a^T D_a + I  (d×d, ridge regression 协方差)
 *       b_a = D_a^T r_a      (d×1, reward sum)
 *     其中 D_a 是历史命中该 action 的 context 矩阵
 *   - 推理时：θ_a = A_a^{-1} b_a
 *     UCB 上界：argmax_a  θ_a^T x + α · √(x^T A_a^{-1} x)
 *
 *   小 α (~0.1)：偏 exploitation
 *   大 α (~2.0)：偏 exploration
 *
 * 本模块：
 *   - 在线推理 selectAction(ctx, candidates)
 *   - update(action, ctx, reward) 增量更新 A, b（O(d²) 内存 per action）
 *   - 默认 d=8（latent 切片），candidates ≤ 4，单用户每秒 < 1 次更新 → 内存可控
 *   - 持久化：每 100 次更新 flush 一次到 localStorage（粗略保存）
 *
 * 集成：
 *   - 通过 `adInsertionRL.setAdInsertionPolicy(banditPolicy)` 注入
 *   - feature flag `adInsertionBandit` 控制启用
 */

const STORAGE_KEY = 'openblock_linucb_state_v1';
const DEFAULT_DIM = 8;
const DEFAULT_ALPHA = 0.5;
const FLUSH_EVERY_N = 100;

/** @typedef {{ dim:number, alpha:number, A:Record<string, number[][]>, b:Record<string, number[]>, updates:number }} BanditState */

let _state = _loadState();
let _writesSinceFlush = 0;

function _loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.dim && parsed?.A && parsed?.b) return parsed;
        }
    } catch { /* ignore */ }
    return { dim: DEFAULT_DIM, alpha: DEFAULT_ALPHA, A: {}, b: {}, updates: 0 };
}

function _saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    } catch { /* ignore quota */ }
}

/* ─────────────────── 矩阵运算（小尺寸，O(d^3) 高斯消元够用） ─────────────────── */

function _identityMatrix(d) {
    return Array.from({ length: d }, (_, i) =>
        Array.from({ length: d }, (_, j) => (i === j ? 1 : 0))
    );
}

function _ensureAction(action) {
    if (!_state.A[action]) _state.A[action] = _identityMatrix(_state.dim);
    if (!_state.b[action]) _state.b[action] = new Array(_state.dim).fill(0);
}

function _matVec(M, v) {
    const d = M.length;
    const out = new Array(d).fill(0);
    for (let i = 0; i < d; i++) {
        const row = M[i];
        for (let j = 0; j < d; j++) out[i] += row[j] * v[j];
    }
    return out;
}

function _dot(a, b) {
    const len = Math.min(a.length, b.length);
    let s = 0;
    for (let i = 0; i < len; i++) s += a[i] * b[i];
    return s;
}

/** 高斯消元解 Ax = b，A 是 d×d；O(d^3)。 d ≤ 16 时性能 OK。 */
function _solve(A, b) {
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < n; i++) {
        let pivot = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
        }
        if (pivot !== i) { const tmp = M[i]; M[i] = M[pivot]; M[pivot] = tmp; }
        const div = M[i][i];
        if (Math.abs(div) < 1e-12) return new Array(n).fill(0);
        for (let j = i; j <= n; j++) M[i][j] /= div;
        for (let k = 0; k < n; k++) {
            if (k === i) continue;
            const factor = M[k][i];
            for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
        }
    }
    return M.map((row) => row[n]);
}

/* ─────────────────── 截取 ctx 到固定 dim ─────────────────── */

function _shrinkContext(ctx) {
    const d = _state.dim;
    const arr = Array.isArray(ctx) ? ctx : [];
    if (arr.length === d) return arr;
    /* 不足填 0；过长截断（取前 d 维：FEATURE_SCHEMA 的 persona/realtime 段） */
    if (arr.length < d) return [...arr, ...new Array(d - arr.length).fill(0)];
    return arr.slice(0, d);
}

/* ─────────────────── 公共 API ─────────────────── */

/**
 * 选择 action（LinUCB）。
 *
 * @param {{ context:number[]|Float32Array, candidates:string[] }} input
 * @returns {{ action:string, ucb:number, theta:number, mean:number, exploration:number, ranking:Array<{action,ucb,mean,exploration}> }}
 */
export function selectAction(input) {
    const candidates = Array.isArray(input?.candidates) && input.candidates.length > 0
        ? input.candidates
        : ['default'];
    const x = _shrinkContext(input?.context);

    const ranking = candidates.map((action) => {
        _ensureAction(action);
        const Ainv_x = _solve(_state.A[action], x);
        const theta = _solve(_state.A[action], _state.b[action]);
        const mean = _dot(theta, x);
        const variance = Math.max(0, _dot(x, Ainv_x));
        const exploration = _state.alpha * Math.sqrt(variance);
        const ucb = mean + exploration;
        return { action, ucb, mean, exploration };
    });

    ranking.sort((a, b) => b.ucb - a.ucb);
    const top = ranking[0];
    return {
        action: top.action,
        ucb: top.ucb,
        theta: top.mean,
        mean: top.mean,
        exploration: top.exploration,
        ranking,
    };
}

/**
 * 在线更新：A_a += x x^T, b_a += r·x。
 *
 * @param {string} action
 * @param {number[]|Float32Array} ctx
 * @param {number} reward
 */
export function updateBandit(action, ctx, reward) {
    if (!action || !Number.isFinite(reward)) return;
    _ensureAction(action);
    const x = _shrinkContext(ctx);
    const A = _state.A[action];
    const b = _state.b[action];
    for (let i = 0; i < x.length; i++) {
        for (let j = 0; j < x.length; j++) A[i][j] += x[i] * x[j];
        b[i] += reward * x[i];
    }
    _state.updates += 1;
    _writesSinceFlush += 1;
    if (_writesSinceFlush >= FLUSH_EVERY_N) {
        _writesSinceFlush = 0;
        _saveState();
    }
}

export function configureBandit({ dim, alpha } = {}) {
    if (Number.isFinite(dim) && dim > 0 && dim <= 32) {
        _state.dim = Math.floor(dim);
        _state.A = {};
        _state.b = {};
    }
    if (Number.isFinite(alpha) && alpha >= 0) _state.alpha = Number(alpha);
}

export function getBanditState() {
    return JSON.parse(JSON.stringify(_state));
}

/** 用于 adInsertionRL 注入：返回与 setAdInsertionPolicy 兼容的函数。 */
export function buildBanditPolicyForAdInsertion() {
    return function banditPolicy(ctx) {
        const candidates = ['rewarded', 'interstitial', 'skip'];
        /* 把 features dict 或 array 都转成 array */
        const arr = Array.isArray(ctx?.features)
            ? ctx.features
            : (ctx?.features ? Object.values(ctx.features) : []);
        const decision = selectAction({ context: arr, candidates });
        return { type: decision.action, exploreSignal: decision.exploration };
    };
}

export function flushBandit() { _saveState(); _writesSinceFlush = 0; }

/** 仅供测试。 */
export function _resetBanditForTests() {
    _state = { dim: DEFAULT_DIM, alpha: DEFAULT_ALPHA, A: {}, b: {}, updates: 0 };
    _writesSinceFlush = 0;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export const _BANDIT_INTERNALS = { DEFAULT_DIM, DEFAULT_ALPHA, FLUSH_EVERY_N };
