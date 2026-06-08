/**
 * 流失预警 + 召回干预（移植 web `retention/churnPredictor.js`）。
 *
 * 引擎无关：基于「近 7 天 vs 前 7 天」的会话数 / 得分 / 时长 / 参与度下降率算出流失风险 0..100，
 * 据此在启动期给出一次「召回干预」(奖励 + 文案)。localStorage → cocos Storage。
 *
 * 数据写入点：每局结束（GameController.settle）调 `recordSession`，让风险评估有真实数据
 *（与 web lifecycleOrchestrator.onSessionEnd 的唯一写入点对齐）。
 * 玩家可见点：启动期 `consumeIntervention(stage)` —— 命中且当日未发过 → 返回奖励+文案 key，由 GameController 发放并 toast。
 *
 * 与 web 差异：web 的 reward/message 是展示用中文串；cocos 侧改为「具体钱包发放 + i18n 文案 key」，
 * 并把发放下限收紧到 medium 以上（low/stable 不打扰，避免对自动发放过于频繁）。
 */
import type { WalletKind } from '../../core';
import { Storage, STORAGE_KEYS } from '../platform/Storage';

const CHURN_WEIGHTS = {
    sessionDecline: 0.25,
    scoreDecline: 0.20,
    durationDecline: 0.15,
    engagementDrop: 0.20,
};

export type ChurnLevel = 'critical' | 'high' | 'medium' | 'low' | 'stable';
export type LifecycleStage = 'onboarding' | 'exploration' | 'growth' | 'stability' | 'winback';

interface Signal { date: string; sessionCount: number; avgDuration: number; avgScore: number; engagement: number }
interface RiskPoint { date: string; risk: number }
interface ChurnData {
    lastUpdated: string;
    signals: Signal[];
    riskHistory: RiskPoint[];
    lastRisk?: number;
    lastInterventionYmd?: string;
}

export interface ChurnInterventionPlan {
    level: ChurnLevel;
    /** i18n 文案 key（churn.critical/high/medium）。 */
    messageKey: string;
    /** token 发放（提示/撤销等）。 */
    tokens: Partial<Record<WalletKind, number>>;
    /** 金币发放。 */
    coins: number;
}

function todayYmd(d = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load(): ChurnData {
    const d = Storage.getJSON<ChurnData>(STORAGE_KEYS.churnData, null as unknown as ChurnData);
    if (d && Array.isArray(d.signals)) return d;
    return { lastUpdated: todayYmd(), signals: [], riskHistory: [] };
}
function save(data: ChurnData): void {
    Storage.setJSON(STORAGE_KEYS.churnData, data);
}

function calculateChurnRisk(signals: Signal[]): number {
    if (signals.length < 3) return 0;
    const recent = signals.slice(-7);
    const older = signals.slice(-14, -7);
    if (older.length === 0) return 0;
    const avg = (arr: Signal[], pick: (s: Signal) => number): number => arr.reduce((a, x) => a + pick(x), 0) / arr.length;
    const decline = (newer: number, old: number): number => (old > 0 ? Math.max(0, 1 - newer / old) : 0);
    const sessionDecline = decline(avg(recent, (s) => s.sessionCount), avg(older, (s) => s.sessionCount));
    const scoreDecline = decline(avg(recent, (s) => s.avgScore), avg(older, (s) => s.avgScore));
    const durationDecline = decline(avg(recent, (s) => s.avgDuration), avg(older, (s) => s.avgDuration));
    const engagementDrop = decline(avg(recent, (s) => s.engagement), avg(older, (s) => s.engagement));
    const risk = (
        sessionDecline * CHURN_WEIGHTS.sessionDecline +
        scoreDecline * CHURN_WEIGHTS.scoreDecline +
        durationDecline * CHURN_WEIGHTS.durationDecline +
        engagementDrop * CHURN_WEIGHTS.engagementDrop
    ) * 100;
    return Math.min(100, Math.round(risk));
}

export function riskLevel(risk: number): ChurnLevel {
    if (risk >= 70) return 'critical';
    if (risk >= 50) return 'high';
    if (risk >= 30) return 'medium';
    if (risk >= 15) return 'low';
    return 'stable';
}

export const ChurnPredictor = {
    /** 每局结束写入会话指标（对齐 web recordSessionMetrics）。 */
    recordSession(input: { sessionCount?: number; duration: number; score: number; engagement: number }): number {
        const today = todayYmd();
        const cur = load();
        const entry: Signal = {
            date: today,
            sessionCount: input.sessionCount ?? 1,
            avgDuration: input.duration || 0,
            avgScore: input.score || 0,
            engagement: Math.max(0, Math.min(1, input.engagement)),
        };
        const signals = [...cur.signals, entry].slice(-14);
        const risk = calculateChurnRisk(signals);
        const riskHistory = [...cur.riskHistory, { date: today, risk }].slice(-30);
        save({ lastUpdated: today, signals, riskHistory, lastRisk: risk, lastInterventionYmd: cur.lastInterventionYmd });
        return risk;
    },

    currentRisk(): number {
        return load().lastRisk ?? 0;
    },

    /**
     * 启动期召回干预：当日未发过、且风险达 medium 以上 → 返回发放方案并标记当日已发；否则 null。
     * onboarding 阶段额外加码（对齐 web getChurnIntervention 对 onboarding 的特殊处理）。
     */
    consumeIntervention(stage: LifecycleStage = 'exploration'): ChurnInterventionPlan | null {
        const data = load();
        const today = todayYmd();
        if (data.lastInterventionYmd === today) return null;
        const level = riskLevel(data.lastRisk ?? 0);
        if (level === 'low' || level === 'stable') return null;

        let plan: ChurnInterventionPlan;
        if (level === 'critical') {
            plan = { level, messageKey: 'churn.critical', tokens: { hintToken: 5, undoToken: 3 }, coins: 80 };
        } else if (level === 'high') {
            plan = { level, messageKey: 'churn.high', tokens: { hintToken: 3 }, coins: 60 };
        } else {
            plan = { level, messageKey: 'churn.medium', tokens: { hintToken: 2 }, coins: 0 };
        }
        // onboarding 期加码一份提示券（鼓励新手坚持）。
        if (stage === 'onboarding') {
            plan = { ...plan, tokens: { ...plan.tokens, hintToken: (plan.tokens.hintToken ?? 0) + 2 } };
        }
        data.lastInterventionYmd = today;
        save(data);
        return plan;
    },
};
