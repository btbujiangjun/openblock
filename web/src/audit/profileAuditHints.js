/**
 * profileAuditHints.js — 把 audit 三层结果（指标/指标对/契约）翻译为可操作的优化建议
 *
 * 设计原则：
 *   - 纯函数：输入 audit 中间结果，输出 hint 列表；不读取业务全局
 *   - 严重度分级：error / warn / info — 配合 CLI 退出码与 UI 配色
 *   - 可定位：每条 hint 自带 `code` 与具体的 `metrics` / `contract`，便于在 UI 高亮
 *   - 可追溯：建议文案里要包含触发它的关键数字（"覆盖率 12%" 而非"覆盖率不足"）
 *
 * 阈值集中在本文件顶部，必要时通过 buildHints(audit, { thresholds }) 覆盖。
 */

/**
 * @typedef {{ severity: 'info'|'warn'|'error', code: string, msg: string,
 *             metrics?: string[], contract?: string, evidence?: unknown }} ProfileAuditHint
 */

/** 默认阈值；用 buildHints(audit, { thresholds: { ... } }) 局部覆盖。 */
export const DEFAULT_THRESHOLDS = {
    coverage: { error: 0.10, warn: 0.30 },         // 覆盖率
    coldRatio: { warn: 0.25, error: 0.50 },        // 冷启动占比
    jitterRel: { warn: 0.50, error: 1.00 },        // medianAbsDiff / stddev 比；> 0.5 噪声偏大
    outOfRangeRate: { warn: 0.01, error: 0.05 },   // 越界帧数比
    redundancy: { warn: 0.92, error: 0.97 },       // |Pearson r|
    stressDominator: { warn: 0.75, error: 0.90 },  // 单一 stress 分量贡献占比
    intentSwitches: { warn: 12, error: 30 },       // 一局内 spawnIntent 切换次数
};

/**
 * @param {object} audit  profileAudit() 输出
 * @param {{ thresholds?: typeof DEFAULT_THRESHOLDS }} [opts]
 * @returns {ProfileAuditHint[]}
 */
export function buildHints(audit, opts = {}) {
    const T = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };
    /** @type {ProfileAuditHint[]} */
    const hints = [];

    /* ===== A. 单指标质量 ===== */
    for (const [key, m] of Object.entries(audit.metrics || {})) {
        // 覆盖率
        if (m.coverage != null) {
            if (m.coverage < T.coverage.error) {
                hints.push({
                    severity: 'error',
                    code: 'COVERAGE_TOO_LOW',
                    metrics: [key],
                    evidence: m.coverage,
                    msg: `「${key}」有效采样仅 ${(m.coverage * 100).toFixed(0)}%——指标几乎"瞎"，建议放宽冷启动门限或推迟 PS 写入时机`,
                });
            } else if (m.coverage < T.coverage.warn) {
                hints.push({
                    severity: 'warn',
                    code: 'COVERAGE_LOW',
                    metrics: [key],
                    evidence: m.coverage,
                    msg: `「${key}」有效采样 ${(m.coverage * 100).toFixed(0)}%——离线统计与个性化模型应剔除冷启动段`,
                });
            }
        }
        // 越界
        if (m.outOfRange?.count > 0 && m.count > 0) {
            const rate = m.outOfRange.count / m.count;
            const sev = rate >= T.outOfRangeRate.error ? 'error'
                : rate >= T.outOfRangeRate.warn ? 'warn' : 'info';
            hints.push({
                severity: sev,
                code: 'OUT_OF_RANGE',
                metrics: [key],
                evidence: m.outOfRange,
                msg: `「${key}」${m.outOfRange.count} 帧越界（约定范围外），首次发生在 idx=${m.outOfRange.firstIdx}——检查计算公式与归一化口径`,
            });
        }
        // 跳变 / 噪声
        if (m.jitter?.medianAbsDiff != null && m.stats?.stddev != null && m.stats.stddev > 1e-6) {
            const relJ = m.jitter.medianAbsDiff / m.stats.stddev;
            if (relJ >= T.jitterRel.error) {
                hints.push({
                    severity: 'warn',
                    code: 'METRIC_JITTERY',
                    metrics: [key],
                    evidence: relJ,
                    msg: `「${key}」逐帧跳变 / 标准差 = ${relJ.toFixed(2)}——曲线噪声偏大，考虑加 EMA 平滑或采样下采样`,
                });
            } else if (relJ >= T.jitterRel.warn) {
                hints.push({
                    severity: 'info',
                    code: 'METRIC_NOISY',
                    metrics: [key],
                    evidence: relJ,
                    msg: `「${key}」轻度抖动（rel jitter ${relJ.toFixed(2)}）——可观察但暂不必平滑`,
                });
            }
        }
    }

    /* ===== B. 指标对关系 ===== */
    for (const pair of audit.pairs || []) {
        if (pair.pearson != null && Math.abs(pair.pearson) >= T.redundancy.error) {
            hints.push({
                severity: 'warn',
                code: 'REDUNDANT_PAIR',
                metrics: [pair.a, pair.b],
                evidence: pair.pearson,
                msg: `「${pair.a}」与「${pair.b}」高度相关（r=${pair.pearson.toFixed(2)}）——信息几乎重复，可考虑合并/取其一减少 UI 与模型噪声`,
            });
        } else if (pair.pearson != null && Math.abs(pair.pearson) >= T.redundancy.warn) {
            hints.push({
                severity: 'info',
                code: 'CORRELATED_PAIR',
                metrics: [pair.a, pair.b],
                evidence: pair.pearson,
                msg: `「${pair.a}」与「${pair.b}」中度相关（r=${pair.pearson.toFixed(2)}）——建模时注意共线性`,
            });
        }
    }

    /* ===== C. 契约违规 ===== */
    for (const c of audit.contracts || []) {
        if (c.passed) continue;
        hints.push({
            severity: 'error',
            code: 'CONTRACT_VIOLATION',
            contract: c.id,
            metrics: c.metrics,
            evidence: c.evidence,
            msg: `契约「${c.desc}」未通过：${c.reason}——检查相关指标的计算实现是否与契约一致`,
        });
    }

    /* ===== D. 链路 ===== */
    const link = audit.linkages || {};
    if (link.stressDominator?.shareOfAbs != null) {
        const s = link.stressDominator.shareOfAbs;
        if (s >= T.stressDominator.error) {
            hints.push({
                severity: 'warn',
                code: 'STRESS_SINGLE_DOMINATOR',
                metrics: ['stress', link.stressDominator.key],
                evidence: link.stressDominator,
                msg: `本局 stress 几乎被「${link.stressDominator.key}」单一支配（${(s * 100).toFixed(0)}%）——自适应未充分介入，检查其他分量是否被钳死或没采样`,
            });
        } else if (s >= T.stressDominator.warn) {
            hints.push({
                severity: 'info',
                code: 'STRESS_DOMINATED',
                metrics: ['stress', link.stressDominator.key],
                evidence: link.stressDominator,
                msg: `stress 主要由「${link.stressDominator.key}」驱动（${(s * 100).toFixed(0)}%）——属正常但偏强势`,
            });
        }
    }
    if (link.intentSwitches != null) {
        if (link.intentSwitches >= T.intentSwitches.error) {
            hints.push({
                severity: 'warn',
                code: 'INTENT_THRASHING',
                metrics: ['spawnIntent'],
                evidence: link.intentSwitches,
                msg: `spawnIntent 一局内切换 ${link.intentSwitches} 次——出块意图抖动剧烈，考虑加去抖窗或滞回阈值`,
            });
        } else if (link.intentSwitches >= T.intentSwitches.warn) {
            hints.push({
                severity: 'info',
                code: 'INTENT_FREQUENT',
                metrics: ['spawnIntent'],
                evidence: link.intentSwitches,
                msg: `spawnIntent 切换 ${link.intentSwitches} 次——偏频繁，关注是否影响体感连贯`,
            });
        }
    }
    if (link.feedbackLagCorr != null && Math.abs(link.feedbackLagCorr) < 0.05 && link.feedbackHasData) {
        hints.push({
            severity: 'info',
            code: 'FEEDBACK_LAG_WEAK',
            metrics: ['feedbackBias', 'stress'],
            evidence: link.feedbackLagCorr,
            msg: `闭环反馈与后续 stress 滞后相关 r=${link.feedbackLagCorr.toFixed(2)}——本局响应弱，可能 feedback 窗口偏短或 stress 被其他强信号盖过`,
        });
    }

    /* ===== 全局：冷启动占比 ===== */
    if (audit.summary?.coldFramesRatio != null) {
        const cfr = audit.summary.coldFramesRatio;
        if (cfr >= T.coldRatio.error) {
            hints.push({
                severity: 'warn',
                code: 'COLD_RATIO_HIGH',
                evidence: cfr,
                msg: `本局 ${(cfr * 100).toFixed(0)}% 帧处于冷启动——离线训练 / 个性化建模请按 firstWarmFrameIdx 截断`,
            });
        } else if (cfr >= T.coldRatio.warn) {
            hints.push({
                severity: 'info',
                code: 'COLD_RATIO_MILD',
                evidence: cfr,
                msg: `冷启动帧占比 ${(cfr * 100).toFixed(0)}%——可接受但需打标`,
            });
        }
    }

    /* 排序：error > warn > info，同级别按 code 字母序，便于稳定 diff */
    const sevOrder = { error: 0, warn: 1, info: 2 };
    hints.sort((a, b) => {
        const s = sevOrder[a.severity] - sevOrder[b.severity];
        return s !== 0 ? s : a.code.localeCompare(b.code);
    });
    return hints;
}

/**
 * 把 hints 聚合为一个简单"健康分"（0-100）：
 *   - 每条 error 扣 12 分，每条 warn 扣 4 分，每条 info 扣 1 分
 *   - 下限 0，上限 100
 *
 * 这只是个粗合成指标，便于报告头一眼看出"今天的画像健康吗"；具体优化仍要看 hints 详情。
 */
export function summarizeHealthScore(hints) {
    let score = 100;
    for (const h of hints) {
        if (h.severity === 'error') score -= 12;
        else if (h.severity === 'warn') score -= 4;
        else score -= 1;
    }
    return Math.max(0, Math.min(100, score));
}
