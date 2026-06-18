/**
 * 放块触感跨端契约：Cocos 原生 / Capacitor / 小程序 / Web 各走各自可用后端。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('crossPlatformHaptics 契约', () => {
    it('Cocos Haptics.ts 原生 iOS/Android 优先走 __openblockHaptic 桥', () => {
        const src = read('cocos/assets/scripts/game/platform/Haptics.ts');
        expect(src).toContain('vibrateNativeBridge');
        expect(src).toContain('OpenBlockHapticHelper');
        expect(src).toContain('com/cocos/game/OpenBlockHapticHelper');
        expect(src).toMatch(/iOS.*禁止降级到 Device\.vibrate/s);
    });

    it('Cocos iOS AppDelegate 注入 UIImpactFeedbackGenerator 桥', () => {
        const src = read('cocos/build-templates/ios/AppDelegate.mm');
        expect(src).toContain('OpenBlockHapticHelper');
        expect(src).toContain('UIImpactFeedbackGenerator');
        expect(src).toContain('__openblockHaptic');
        expect(src).toContain('injectOpenBlockHapticBridge');
    });

    it('Cocos Android AppActivity 注入 Vibrator 桥且声明 VIBRATE 权限', () => {
        const activity = read('cocos/build-templates/android/app/src/com/cocos/game/AppActivity.java');
        const manifest = read('cocos/build-templates/android/app/AndroidManifest.xml');
        expect(activity).toContain('OpenBlockHapticHelper');
        expect(activity).toContain('injectOpenBlockHapticBridge');
        expect(manifest).toContain('android.permission.VIBRATE');
    });

    it('Capacitor 原生端注册 @capacitor/haptics 插件', () => {
        const pkg = read('mobile/ios/App/CapApp-SPM/Package.swift');
        const gradle = read('mobile/android/capacitor.settings.gradle');
        expect(pkg).toContain('CapacitorHaptics');
        expect(gradle).toContain('capacitor-haptics');
    });

    it('小程序放块映射 light 触感', () => {
        const src = read('miniprogram/utils/audioFx.js');
        expect(src).toContain("place: 'light'");
        expect(src).toContain('wx.vibrateShort');
    });

    it('Web 放块在未消行时触发 8ms 触感', () => {
        const src = read('web/src/game.js');
        expect(src).toContain("window.__audioFx?.vibrate?.([8])");
    });
});

describe('Capacitor iOS 放块触感', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('原生端放块短脉冲映射为 LIGHT impact', async () => {
        const impact = vi.fn().mockResolvedValue(undefined);
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'ios',
            Plugins: { Haptics: { impact } },
        };
        const { vibrate } = await import('../web/src/effects/haptics.js');
        vibrate(8);
        await vi.waitFor(() => {
            expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' });
        });
    });
});
