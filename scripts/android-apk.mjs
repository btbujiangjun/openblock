#!/usr/bin/env node
/**
 * 构建 Android APK（需 JDK 21 + Android SDK）。
 * 用法：npm run mobile:apk:debug | npm run mobile:apk:release
 * 会先执行 mobile:build（Web + cap sync），再调用 Gradle assembleDebug / assembleRelease。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const variant = process.argv[2] === 'release' ? 'release' : 'debug';
const task = variant === 'release' ? 'assembleRelease' : 'assembleDebug';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'mobile', 'android');
const gradlew = join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

function findJavaHome() {
    const r = spawnSync('bash', [join(root, 'scripts/android-env.sh'), '--java-home', 'mobile'], {
        encoding: 'utf8',
    });
    if (r.status === 0 && r.stdout?.trim()) {
        return r.stdout.trim();
    }
    return process.env.JAVA_HOME || '';
}

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd || root, env: opts.env || process.env });
    if (r.status !== 0) process.exit(r.status ?? 1);
}

const javaHome = findJavaHome();
if (!javaHome) {
    console.error('[android-apk] 未找到 JDK 21。请安装：brew install openjdk@21');
    process.exit(1);
}

const env = { ...process.env, JAVA_HOME: javaHome, PATH: `${join(javaHome, 'bin')}:${process.env.PATH}` };

console.log(`[android-apk] JAVA_HOME=${javaHome}`);
console.log('[android-apk] npm run mobile:build …');
run('npm', ['run', 'mobile:build'], { env });

if (variant === 'release') {
    const props = join(androidDir, 'signing', 'keystore.properties');
    if (!existsSync(props)) {
        console.error(
            '[android-apk] Release 需要签名配置：\n'
            + '  cp mobile/android/signing/keystore.properties.example mobile/android/signing/keystore.properties\n'
            + '  并放置对应 .keystore 文件（见 mobile/android/signing/README 若存在）',
        );
        process.exit(1);
    }
}

console.log(`[android-apk] ./gradlew ${task} …`);
run(gradlew, [task, '--no-daemon'], { cwd: androidDir, env });

const apkDir = join(androidDir, 'app', 'build', 'outputs', 'apk', variant);
const apkName = variant === 'release' ? 'app-release.apk' : 'app-debug.apk';
console.log(`\n[android-apk] 完成 → ${join(apkDir, apkName)}\n`);
