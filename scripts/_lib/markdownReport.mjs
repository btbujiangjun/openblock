/**
 * v1.71 NN-D3: scripts/* 公共 markdown 报告片段生成。
 *
 * 复用方：
 *   - perf-check (KK4 sparkline)
 *   - benchmark-suite (II5 trend history)
 *   - audit-artifacts (LL3 health report)
 *
 * 设计：纯函数 + 无 I/O，便于测试。
 */

const SPARK = '▁▂▃▄▅▆▇█';

/**
 * 把数值数组转成 8-tone unicode sparkline。
 * @param {number[]} values
 * @returns {string}
 */
export function sparkline(values) {
    if (!Array.isArray(values) || values.length === 0) return '';
    const finite = values.filter(Number.isFinite);
    if (finite.length === 0) return '';
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    const range = max - min;
    if (range === 0) return SPARK[3].repeat(values.length);
    return values.map((v) => {
        if (!Number.isFinite(v)) return '·';
        const norm = (v - min) / range;
        const i = Math.min(SPARK.length - 1, Math.floor(norm * SPARK.length));
        return SPARK[i];
    }).join('');
}

/**
 * 简洁百分比 delta（带正负符号、固定 1 位小数）。
 * @param {number} cur
 * @param {number} prev
 * @returns {string}  "+12.3%" / "-0.4%" / "0.0%" / "—"（prev=0）
 */
export function pctDelta(cur, prev) {
    if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return '—';
    const d = ((cur - prev) / Math.abs(prev)) * 100;
    const sign = d > 0 ? '+' : '';
    return `${sign}${d.toFixed(1)}%`;
}

/**
 * Markdown table 渲染。
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @returns {string}
 */
export function mdTable(headers, rows) {
    if (headers.length === 0) return '';
    const head = `| ${headers.join(' | ')} |`;
    const sep = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map((r) => `| ${r.map(String).join(' | ')} |`).join('\n');
    return `${head}\n${sep}${body ? '\n' + body : ''}`;
}

/**
 * KB/MB/GB 友好格式。
 * @param {number} bytes
 * @returns {string}
 */
export function fmtBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
