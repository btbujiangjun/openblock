/**
 * v1.71 NN-C4: schema 版本守护 + 迁移公共工具。
 *
 * 复用方：
 *   - scripts/perf-check.mjs（NN-C1 perf-baseline）
 *   - scripts/benchmark-suite.mjs（LL5 trend-history）
 *   - web/src/gameRules.js（NN-C3）— ESM 客户端无法直接 import 此文件，
 *     仅在脚本工具层复用（避免引入 Node API 到客户端 bundle）
 *
 * 行为：
 *   - 未来版本（data.schemaVersion > current）→ 调用方决定 throw / process.exit
 *   - 旧版本 → migrate 函数升级（caller 提供 migrationChain）
 *   - 当前版本 → 原样返回
 *   - 无 schemaVersion 字段 → 视作 v1（最古老版本）
 */

/**
 * @param {object} data 已 parse 的 JSON
 * @param {{
 *   currentVersion: number,
 *   name: string,
 *   migrations?: Record<number, (data: object) => object>,
 * }} opts
 *   - migrations[N] 接受 v(N-1) 数据，返回升级到 vN 的数据
 *   - 例：{ 2: (v1) => ({ ...v1, schemaVersion: 2, newField: 'x' }) }
 * @returns {{ migrated: object, fromVersion: number, didMigrate: boolean, status: 'ok' | 'migrated' | 'future' }}
 */
export function checkAndMigrate(data, opts) {
    const { currentVersion, name, migrations = {} } = opts;
    const fromVersion = data?.schemaVersion ?? data?.meta?.schemaVersion ?? 1;

    if (fromVersion === currentVersion) {
        return { migrated: data, fromVersion, didMigrate: false, status: 'ok' };
    }
    if (fromVersion > currentVersion) {
        return { migrated: data, fromVersion, didMigrate: false, status: 'future' };
    }

    /* 依次执行 migrations[fromVersion+1] ... migrations[currentVersion] */
    let cur = data;
    for (let v = fromVersion + 1; v <= currentVersion; v++) {
        const fn = migrations[v];
        if (typeof fn === 'function') {
            cur = fn(cur);
        }
    }
    /* 兜底：确保 schemaVersion 字段已 bump 到 current（在 meta.* 或顶层） */
    if (cur && cur.meta && typeof cur.meta === 'object') {
        cur = { ...cur, meta: { ...cur.meta, schemaVersion: currentVersion } };
    } else if (cur && typeof cur === 'object') {
        cur = { ...cur, schemaVersion: currentVersion };
    }
    return {
        migrated: cur,
        fromVersion,
        didMigrate: true,
        status: 'migrated',
        _name: name,
    };
}

/**
 * 便捷封装：未来版本时 process.exit(3)。供 CLI 脚本直接用。
 *
 * @param {object} data
 * @param {object} opts 同 checkAndMigrate
 * @returns {object} migrated data
 */
export function assertCurrentOrMigrate(data, opts) {
    const r = checkAndMigrate(data, opts);
    if (r.status === 'future') {
        console.error(`[${opts.name}] schemaVersion=${r.fromVersion} > 脚本支持的 ${opts.currentVersion}`);
        console.error(`             → 升级 ${opts.name} 脚本后再用（防字段误解读）`);
        process.exit(3);
    }
    if (r.status === 'migrated') {
        console.error(`[${opts.name}] v${r.fromVersion} → v${opts.currentVersion} 自动迁移`);
    }
    return r.migrated;
}
