/**
 * v1.71 NN-D3: scripts/* 公共 CLI 解析。
 *
 * 复用方：perf-check / audit-artifacts / benchmark-suite / lint-* /
 * sync-cocos-* 等多个 CLI 脚本，避免每个文件重写 argv 解析。
 *
 * 设计：
 *   - cliArg(name, fallback) 读 --name <value>
 *   - cliFlag(name) 读 --name 布尔
 *   - cliNumber(name, fallback) 数值 + NaN 守护
 *   - parseArgs(argv?) 一次性解析返回 { args, flags, positional }
 */

const _argv = () => process.argv.slice(2);

export function cliArg(name, fallback, argv = _argv()) {
    const i = argv.indexOf(name);
    if (i === -1) return fallback;
    return argv[i + 1] ?? fallback;
}

export function cliFlag(name, argv = _argv()) {
    return argv.includes(name);
}

export function cliNumber(name, fallback, argv = _argv()) {
    const v = Number(cliArg(name, fallback, argv));
    return Number.isFinite(v) ? v : fallback;
}

/**
 * @param {string[]} [argv]
 * @returns {{ args: Record<string, string>, flags: Set<string>, positional: string[] }}
 */
export function parseArgs(argv = _argv()) {
    const args = {};
    const flags = new Set();
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) {
                flags.add(key);
            } else {
                args[key] = next;
                i++;
            }
        } else {
            positional.push(a);
        }
    }
    return { args, flags, positional };
}
