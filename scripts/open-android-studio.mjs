#!/usr/bin/env node
/**
 * 用 Android Studio 打开指定 Gradle 工程（默认 Capacitor mobile/android）。
 * 替代 `cap open android`，在未安装 IDE 时给出可操作的错误提示。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectArg = process.argv[2] || 'mobile/android';
const project = resolve(root, projectArg);

if (!existsSync(project)) {
    console.error(`[open-android-studio] 工程目录不存在：${project}`);
    console.error('  先执行：npm run mobile:build  或  cocos/scripts/build-android.sh');
    process.exit(1);
}

const r = spawnSync('bash', [join(root, 'scripts/android-env.sh'), '--open', project], {
    stdio: 'inherit',
});
process.exit(r.status ?? 1);
