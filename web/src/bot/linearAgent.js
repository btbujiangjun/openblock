/**
 * 线性 softmax 策略 + 线性状态价值基线（REINFORCE with baseline）
 *
 * v2.2: 恢复线性架构（在 REINFORCE 单局在线更新下最可靠），
 *       配合 trainer.js 的训练改进（回报/优势标准化、熵正则、梯度裁剪）突破旧版 150 天花板。
 *
 * 策略：logit = W·φ(s,a)，W ∈ ℝ^{PHI_DIM}
 * 价值：V(s)  = Vw·ψ(s)，Vw ∈ ℝ^{STATE_FEATURE_DIM}
 */
// 当前 linearAgent 通过 trainer 注入的特征向量直接消费 W/Vw 维度，无需在此再次提取；
// 保留 PHI_DIM / STATE_FEATURE_DIM 以校准矩阵尺寸。
import {
    PHI_DIM,
    STATE_FEATURE_DIM
} from './features.js';

function softmax(logits) {
    const n = logits.length;
    let max = -Infinity;
    for (let i = 0; i < n; i++) if (logits[i] > max) max = logits[i];
    const ex = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
        ex[i] = Math.exp(Math.min(20, logits[i] - max));
        sum += ex[i];
    }
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = ex[i] / sum;
    return p;
}

function sampleDiscrete(probs) {
    let r = Math.random();
    for (let i = 0; i < probs.length; i++) {
        r -= probs[i];
        if (r <= 0) return i;
    }
    return probs.length - 1;
}

function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}

const STORAGE_KEY = 'bb_rl_linear_agent_v2';

/** @type {null | ((payload: object) => void)} */
let _persistHook = null;

/** 训练保存时额外回调（如同步 SQLite）；由 rlPanel 在启用 DB 时注册。 */
export function setBrowserRlLinearPersistHook(fn) {
    _persistHook = typeof fn === 'function' ? fn : null;
}

export function isValidLinearAgentPayload(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }
    return (
        Array.isArray(obj.W)
        && obj.W.length === PHI_DIM
        && Array.isArray(obj.Vw)
        && obj.Vw.length === STATE_FEATURE_DIM
    );
}

/** 是否已有本地存档（用于首次仅有 localStorage 时单向回填 SQLite，避免上传随机初始化权重） */
export function hasSavedLinearAgentInLocalStorage() {
    try {
        return Boolean(localStorage.getItem(STORAGE_KEY));
    } catch {
        return false;
    }
}

export class LinearAgent {
    constructor() {
        this.W = new Float32Array(PHI_DIM);
        this.Vw = new Float32Array(STATE_FEATURE_DIM);
        for (let i = 0; i < PHI_DIM; i++) this.W[i] = (Math.random() - 0.5) * 0.05;
        for (let i = 0; i < STATE_FEATURE_DIM; i++) this.Vw[i] = (Math.random() - 0.5) * 0.05;
    }

    value(stateFeat) {
        return dot(this.Vw, stateFeat);
    }

    actionDistribution(phiList) {
        const logits = new Float32Array(phiList.length);
        for (let i = 0; i < phiList.length; i++) logits[i] = dot(this.W, phiList[i]);
        return { probs: softmax(logits), logits };
    }

    selectAction(phiList, stateFeat, temperature = 1) {
        if (phiList.length === 0) return null;
        const logits = new Float32Array(phiList.length);
        for (let i = 0; i < phiList.length; i++) {
            logits[i] = dot(this.W, phiList[i]) / Math.max(0.15, temperature);
        }
        const probs = softmax(logits);
        const idx = sampleDiscrete(probs);
        const logProb = Math.log(probs[idx] + 1e-12);
        return { idx, logProb, probs, phiList, stateFeat: new Float32Array(stateFeat) };
    }

    /**
     * ∂logπ(a)/∂W = φ_a − Σ_k π_k φ_k
     * 由 trainer.js 调用；在优势已中心化时梯度无偏。
     */
    policyGradient(phiList, probs, chosenIdx) {
        const grad = new Float32Array(PHI_DIM);
        for (let j = 0; j < PHI_DIM; j++) {
            let exp = 0;
            for (let k = 0; k < phiList.length; k++) exp += probs[k] * phiList[k][j];
            grad[j] = phiList[chosenIdx][j] - exp;
        }
        return grad;
    }

    /**
     * ∇_W H(π) = Σ_k (∂H/∂z_k) φ_k，其中 z 为 logits、π=softmax(z)，∂H/∂z_k = −π_k(log π_k + H)。
     * 用于策略梯度与熵 bonus 叠加：W += lr · (A·∇logπ + β·∇H)。
     */
    entropyPolicyGradient(phiList, probs) {
        const n = phiList.length;
        let H = 0;
        for (let k = 0; k < n; k++) {
            const p = probs[k];
            if (p > 1e-12) H -= p * Math.log(p);
        }
        const grad = new Float32Array(PHI_DIM);
        for (let k = 0; k < n; k++) {
            const p = probs[k];
            const logp = Math.log(Math.max(p, 1e-12));
            const dhDz = -p * (logp + H);
            const phi = phiList[k];
            for (let j = 0; j < PHI_DIM; j++) grad[j] += dhDz * phi[j];
        }
        return grad;
    }

    applyPolicyUpdateCombined(policyGrad, advantage, entropyGrad, entropyCoef, lr) {
        const beta = entropyCoef > 0 && entropyGrad ? entropyCoef : 0;
        for (let i = 0; i < PHI_DIM; i++) {
            let d = advantage * policyGrad[i];
            if (beta > 0) d += beta * entropyGrad[i];
            this.W[i] += lr * d;
        }
    }

    _backpropPolicy(phi, scale) {
        for (let i = 0; i < PHI_DIM; i++) this.W[i] += scale * phi[i];
    }

    applyPolicyUpdate(grad, advantage, lr) {
        const a = lr * advantage;
        for (let i = 0; i < PHI_DIM; i++) this.W[i] += a * grad[i];
    }

    applyValueUpdate(stateFeat, delta, lr) {
        const a = lr * delta;
        for (let i = 0; i < STATE_FEATURE_DIM; i++) this.Vw[i] += a * stateFeat[i];
    }

    countParams() {
        return PHI_DIM + STATE_FEATURE_DIM;
    }

    toJSON() {
        return { W: Array.from(this.W), Vw: Array.from(this.Vw) };
    }

    static fromJSON(obj) {
        const a = new LinearAgent();
        if (obj.version === 'mlp_v1') return new LinearAgent();
        if (obj.W && obj.W.length === PHI_DIM) a.W = Float32Array.from(obj.W);
        if (obj.Vw && obj.Vw.length === STATE_FEATURE_DIM) a.Vw = Float32Array.from(obj.Vw);
        return a;
    }

    save() {
        const payload = this.toJSON();
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch { /* ignore */ }
        if (_persistHook) {
            try {
                _persistHook(payload);
            } catch { /* ignore */ }
        }
    }

    static load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return LinearAgent.fromJSON(JSON.parse(raw));
        } catch { /* ignore */ }
        return new LinearAgent();
    }
}
