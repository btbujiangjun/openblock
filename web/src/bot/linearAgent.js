/**
 * 线性 softmax 策略 + 线性状态价值基线（REINFORCE with baseline）
 * 思路类似 AlphaGo 中的策略梯度与方差缩减，规模极小、可在浏览器自博弈更新。
 */
import {
    extractStateFeatures,
    extractActionFeatures,
    PHI_DIM,
    STATE_FEATURE_DIM
} from './features.js';

function softmax(logits) {
    const n = logits.length;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
        if (logits[i] > max) {
            max = logits[i];
        }
    }
    const ex = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
        ex[i] = Math.exp(Math.min(20, logits[i] - max));
        sum += ex[i];
    }
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        p[i] = ex[i] / sum;
    }
    return p;
}

function sampleDiscrete(probs) {
    let r = Math.random();
    for (let i = 0; i < probs.length; i++) {
        r -= probs[i];
        if (r <= 0) {
            return i;
        }
    }
    return probs.length - 1;
}

function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
        s += a[i] * b[i];
    }
    return s;
}

const STORAGE_KEY = 'bb_rl_linear_agent_v1';

export class LinearAgent {
    constructor() {
        /** 策略：logit = W·φ(s,a) */
        this.W = new Float32Array(PHI_DIM);
        /** 价值：V(s) = Vw·ψ(s)，ψ 仅状态维 */
        this.Vw = new Float32Array(STATE_FEATURE_DIM);
        for (let i = 0; i < PHI_DIM; i++) {
            this.W[i] = (Math.random() - 0.5) * 0.05;
        }
        for (let i = 0; i < STATE_FEATURE_DIM; i++) {
            this.Vw[i] = (Math.random() - 0.5) * 0.05;
        }
    }

    value(stateFeat) {
        return dot(this.Vw, stateFeat);
    }

    /**
     * @param {Float32Array[]} phiList 每个合法动作的 φ
     * @returns {{ probs: Float32Array, logits: Float32Array }}
     */
    actionDistribution(phiList) {
        const logits = new Float32Array(phiList.length);
        for (let i = 0; i < phiList.length; i++) {
            logits[i] = dot(this.W, phiList[i]);
        }
        return { probs: softmax(logits), logits };
    }

    /**
     * @returns {{ idx: number, logProb: number, probs: Float32Array, phiList: Float32Array[], stateFeat: Float32Array }}
     */
    selectAction(phiList, stateFeat, temperature = 1) {
        if (phiList.length === 0) {
            return null;
        }
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
     * ∂logπ(a)/∂W = φ_a - Σ_k π_k φ_k
     */
    policyGradient(phiList, probs, chosenIdx) {
        const grad = new Float32Array(PHI_DIM);
        for (let j = 0; j < PHI_DIM; j++) {
            let exp = 0;
            for (let k = 0; k < phiList.length; k++) {
                exp += probs[k] * phiList[k][j];
            }
            grad[j] = phiList[chosenIdx][j] - exp;
        }
        return grad;
    }

    applyPolicyUpdate(grad, advantage, lr) {
        const a = lr * advantage;
        for (let i = 0; i < PHI_DIM; i++) {
            this.W[i] += a * grad[i];
        }
    }

    applyValueUpdate(stateFeat, delta, lr) {
        const a = lr * delta;
        for (let i = 0; i < STATE_FEATURE_DIM; i++) {
            this.Vw[i] += a * stateFeat[i];
        }
    }

    toJSON() {
        return {
            W: Array.from(this.W),
            Vw: Array.from(this.Vw)
        };
    }

    static fromJSON(obj) {
        const a = new LinearAgent();
        if (obj.W && obj.W.length === PHI_DIM) {
            a.W = Float32Array.from(obj.W);
        }
        if (obj.Vw && obj.Vw.length === STATE_FEATURE_DIM) {
            a.Vw = Float32Array.from(obj.Vw);
        }
        return a;
    }

    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON()));
        } catch {
            /* ignore */
        }
    }

    static load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                return LinearAgent.fromJSON(JSON.parse(raw));
            }
        } catch {
            /* ignore */
        }
        return new LinearAgent();
    }
}
