/**
 * profileAudit.worker.js — 在 Worker 中跑 auditProfile / aggregate / actions，避免阻塞主线程。
 *
 * 协议：
 *   { id, type: 'audit', frames, opts? }
 *     → { id, ok: true, report }
 *   { id, type: 'aggregate', reports }
 *     → { id, ok: true, aggregate }
 *   { id, type: 'summarize-actions', aggregate }
 *     → { id, ok: true, actions }
 *   失败：{ id, ok: false, error }
 */
import {
    auditProfile,
    aggregateAuditReports,
    summarizeOptimizationActions,
} from './audit/profileAudit.js';

self.addEventListener('message', (event) => {
    const { id, type } = event.data || {};
    try {
        if (type === 'audit') {
            const report = auditProfile(event.data.frames, event.data.opts || {});
            self.postMessage({ id, ok: true, report });
        } else if (type === 'aggregate') {
            const aggregate = aggregateAuditReports(event.data.reports);
            self.postMessage({ id, ok: true, aggregate });
        } else if (type === 'summarize-actions') {
            const actions = summarizeOptimizationActions(event.data.aggregate);
            self.postMessage({ id, ok: true, actions });
        } else {
            self.postMessage({ id, ok: false, error: `unknown type: ${type}` });
        }
    } catch (e) {
        self.postMessage({ id, ok: false, error: String(e?.message || e) });
    }
});
