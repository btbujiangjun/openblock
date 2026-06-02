#!/usr/bin/env node
// 从 docs/architecture/assets/icon.png 同步 Web / Android / iOS / 微信小程序应用图标。
// 用法: node scripts/sync-app-icon.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'docs/architecture/assets/icon.png');

/** @param {string} outPath @param {number} size */
function resizePng(outPath, size) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    execSync(
        `sips -z ${size} ${size} "${SOURCE}" --out "${outPath}"`,
        { stdio: 'pipe' },
    );
}

function main() {
    if (!fs.existsSync(SOURCE)) {
        console.error(`[sync-app-icon] 源文件不存在: ${SOURCE}`);
        process.exit(1);
    }

    const meta = execSync(`sips -g pixelWidth -g pixelHeight "${SOURCE}"`, { encoding: 'utf8' });
    console.info(`[sync-app-icon] 源: ${SOURCE}\n${meta.trim()}`);

    // ── Web（游戏资源 + public 根 favicon）──
    const webImages = path.join(ROOT, 'web/assets/images');
    for (const size of [32, 180, 192, 512]) {
        resizePng(path.join(webImages, `icon-${size}.png`), size);
    }
    resizePng(path.join(ROOT, 'web/public/favicon.png'), 32);
    // public 副本：Vite 构建时复制到 dist 根，manifest 的 /assets/images/* 在 standalone 部署时也可用
    const pubImages = path.join(ROOT, 'web/public/assets/images');
    fs.mkdirSync(pubImages, { recursive: true });
    for (const size of [192, 512]) {
        fs.copyFileSync(
            path.join(webImages, `icon-${size}.png`),
            path.join(pubImages, `icon-${size}.png`),
        );
    }

    // ── iOS Capacitor（1024 App Store / Xcode）──
    resizePng(
        path.join(ROOT, 'mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/icon.png'),
        1024,
    );

    // ── Android mipmap（legacy launcher + adaptive foreground）──
    const androidRes = path.join(ROOT, 'mobile/android/app/src/main/res');
    const androidTargets = [
        { folder: 'mipmap-mdpi', launcher: 48, foreground: 108 },
        { folder: 'mipmap-hdpi', launcher: 72, foreground: 162 },
        { folder: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
        { folder: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
        { folder: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
    ];
    for (const { folder, launcher, foreground } of androidTargets) {
        const dir = path.join(androidRes, folder);
        resizePng(path.join(dir, 'ic_launcher.png'), launcher);
        resizePng(path.join(dir, 'ic_launcher_round.png'), launcher);
        resizePng(path.join(dir, 'ic_launcher_foreground.png'), foreground);
    }

    // ── 微信小程序多端（project.miniapp.json）──
    const mpIconDir = path.join(ROOT, 'miniprogram/assets/app-icon');
    const mpSizes = {
        'android-hdpi.png': 72,
        'android-xhdpi.png': 96,
        'android-xxhdpi.png': 144,
        'android-xxxhdpi.png': 192,
        'ios-main-120.png': 120,
        'ios-main-180.png': 180,
        'ios-spotlight-80.png': 80,
        'ios-spotlight-120.png': 120,
        'ios-settings-58.png': 58,
        'ios-settings-87.png': 87,
        'ios-notification-40.png': 40,
        'ios-notification-60.png': 60,
        'app-store-1024.png': 1024,
    };
    for (const [name, size] of Object.entries(mpSizes)) {
        resizePng(path.join(mpIconDir, name), size);
    }

    // 更新 project.miniapp.json 图标路径（相对 miniprogram/ 根）
    const miniappJsonPath = path.join(ROOT, 'miniprogram/project.miniapp.json');
    const miniapp = JSON.parse(fs.readFileSync(miniappJsonPath, 'utf8'));
    if (miniapp['mini-android']?.icons) {
        miniapp['mini-android'].icons = {
            hdpi: 'assets/app-icon/android-hdpi.png',
            xhdpi: 'assets/app-icon/android-xhdpi.png',
            xxhdpi: 'assets/app-icon/android-xxhdpi.png',
            xxxhdpi: 'assets/app-icon/android-xxxhdpi.png',
        };
    }
    if (miniapp['mini-ios']?.icons) {
        miniapp['mini-ios'].icons = {
            mainIcon120: 'assets/app-icon/ios-main-120.png',
            mainIcon180: 'assets/app-icon/ios-main-180.png',
            spotlightIcon80: 'assets/app-icon/ios-spotlight-80.png',
            spotlightIcon120: 'assets/app-icon/ios-spotlight-120.png',
            settingsIcon58: 'assets/app-icon/ios-settings-58.png',
            settingsIcon87: 'assets/app-icon/ios-settings-87.png',
            notificationIcon40: 'assets/app-icon/ios-notification-40.png',
            notificationIcon60: 'assets/app-icon/ios-notification-60.png',
            appStore1024: 'assets/app-icon/app-store-1024.png',
        };
    }
    fs.writeFileSync(miniappJsonPath, `${JSON.stringify(miniapp, null, 2)}\n`);

    console.info('[sync-app-icon] 完成 — Web / Android / iOS / 微信小程序图标已同步');
}

main();
