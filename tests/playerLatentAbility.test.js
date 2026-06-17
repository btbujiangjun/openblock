import { describe, it, expect } from 'vitest';
import {
    LATENT_DIMS,
    createLatentState,
    mapAbilityToObservation,
    updateLatentState,
    latentConfidence,
    getCalibrationVector,
    snapshotLatent,
    serializeLatent,
    deserializeLatent
} from '../web/src/playerLatentAbility.js';

const CFG = {
    minConfidence: 0.45,
    latentAbility: { priorMu: 0.5, priorSigma: 0.25, beta: 0.12, sigmaFloor: 0.06, confN0: 12 }
};

describe('playerLatentAbility — θ⃗ 贝叶斯标定器', () => {
    it('createLatentState 6 维先验 μ=0.5 / σ=priorSigma', () => {
        const s = createLatentState(CFG);
        expect(Object.keys(s.dims).sort()).toEqual([...LATENT_DIMS].sort());
        for (const d of LATENT_DIMS) {
            expect(s.dims[d].mu).toBeCloseTo(0.5, 6);
            expect(s.dims[d].sigma).toBeCloseTo(0.25, 6);
        }
        expect(s.n).toBe(0);
    });

    it('冷启动 confidence=0，getCalibrationVector 返回 null（退回恒等标定）', () => {
        const s = createLatentState(CFG);
        expect(latentConfidence(s, CFG)).toBe(0);
        expect(getCalibrationVector(s, CFG)).toBeNull();
    });

    it('mapAbilityToObservation 不吃绝对分数，只映射行为质量到 6 维 [0,1]', () => {
        const obs = mapAbilityToObservation({
            skillScore: 0.8, controlScore: 0.7, clearEfficiency: 0.6, boardPlanning: 0.9, riskLevel: 0.2,
            score: 99999, bestScore: 99999
        });
        for (const d of LATENT_DIMS) {
            expect(obs[d]).toBeGreaterThanOrEqual(0);
            expect(obs[d]).toBeLessThanOrEqual(1);
        }
        expect(obs.spatial).toBeCloseTo(0.9, 6);       // ← boardPlanning
        expect(obs.recovery).toBeCloseTo(0.8, 6);       // ← 1 - riskLevel
        expect(obs.combo).toBeCloseTo(0.6, 6);          // ← clearEfficiency
    });

    it('更新单调收敛：持续高能力观测 → μ 上升、σ 收缩、confidence 上升', () => {
        let s = createLatentState(CFG);
        const obs = mapAbilityToObservation({ skillScore: 0.9, controlScore: 0.9, clearEfficiency: 0.9, boardPlanning: 0.9, riskLevel: 0.1 });
        const c0 = latentConfidence(s, CFG);
        const mu0 = s.dims.spatial.mu;
        const sig0 = s.dims.spatial.sigma;
        for (let i = 0; i < 20; i++) s = updateLatentState(s, obs, CFG);
        expect(s.dims.spatial.mu).toBeGreaterThan(mu0);
        expect(s.dims.spatial.sigma).toBeLessThan(sig0);
        expect(latentConfidence(s, CFG)).toBeGreaterThan(c0);
        expect(s.n).toBe(20);
    });

    it('σ 不低于 sigmaFloor', () => {
        let s = createLatentState(CFG);
        const obs = mapAbilityToObservation({ skillScore: 0.5, controlScore: 0.5, clearEfficiency: 0.5, boardPlanning: 0.5, riskLevel: 0.5 });
        for (let i = 0; i < 200; i++) s = updateLatentState(s, obs, CFG);
        for (const d of LATENT_DIMS) expect(s.dims[d].sigma).toBeGreaterThanOrEqual(CFG.latentAbility.sigmaFloor - 1e-9);
    });

    it('高置信后 getCalibrationVector 返回 6 维 μ', () => {
        let s = createLatentState(CFG);
        const obs = mapAbilityToObservation({ skillScore: 0.7, controlScore: 0.7, clearEfficiency: 0.7, boardPlanning: 0.7, riskLevel: 0.3 });
        for (let i = 0; i < 30; i++) s = updateLatentState(s, obs, CFG);
        const cal = getCalibrationVector(s, CFG);
        expect(cal).not.toBeNull();
        expect(Object.keys(cal).sort()).toEqual([...LATENT_DIMS].sort());
    });

    it('序列化往返保真', () => {
        let s = createLatentState(CFG);
        const obs = mapAbilityToObservation({ skillScore: 0.6, controlScore: 0.55, clearEfficiency: 0.65, boardPlanning: 0.7, riskLevel: 0.25 });
        for (let i = 0; i < 8; i++) s = updateLatentState(s, obs, CFG);
        const round = deserializeLatent(JSON.parse(JSON.stringify(serializeLatent(s))), CFG);
        expect(round.n).toBe(s.n);
        for (const d of LATENT_DIMS) {
            expect(round.dims[d].mu).toBeCloseTo(s.dims[d].mu, 9);
            expect(round.dims[d].sigma).toBeCloseTo(s.dims[d].sigma, 9);
        }
    });

    it('snapshotLatent 输出 μ/σ/confidence 完整可观测', () => {
        const s = createLatentState(CFG);
        const snap = snapshotLatent(s, CFG);
        expect(snap.confidence).toBe(0);
        expect(Object.keys(snap.mu).length).toBe(LATENT_DIMS.length);
        expect(Object.keys(snap.sigma).length).toBe(LATENT_DIMS.length);
    });
});
