const VISUAL_STORAGE_KEY = 'openblock_visualfx_v1';
const QUALITY_STORAGE_KEY = 'openblock_quality_v1';
const IOS_NATIVE_FEEDBACK_INIT_KEY = 'openblock_ios_native_feedback_init_v2';

const DEFAULT_VISUAL_PREFS = { enabled: true };
const DEFAULT_QUALITY_PREFS = { mode: 'high' };
const QUALITY_MODES = ['high', 'balanced', 'low'];

function isAndroidClient() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    try {
        if (document.documentElement.classList.contains('android-client')) return true;
        return /android/i.test(window.navigator?.userAgent || '');
    } catch {
        return false;
    }
}

function isLowEndAndroidClient() {
    if (!isAndroidClient()) return false;
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const cores = Number(nav.hardwareConcurrency) || 0;
    const mem = Number(nav.deviceMemory) || 0;
    // deviceMemory 在部分 WebView 不暴露；未知时仍按保守低配策略处理。
    return !mem || mem <= 4 || !cores || cores <= 4;
}

function isIOSNativeClient() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    try {
        if (document.documentElement.classList.contains('ios-client')) return true;
        const cap = window.Capacitor;
        const isIOS = typeof cap?.getPlatform === 'function' && cap.getPlatform() === 'ios';
        const isNative = typeof cap?.isNativePlatform === 'function'
            ? cap.isNativePlatform()
            : document.documentElement.classList.contains('native-client');
        return Boolean(isIOS && isNative);
    } catch {
        return false;
    }
}

function normalizeIOSNativeFeedbackPrefs(visualPrefs, qualityPrefs, audioFx) {
    if (!isIOSNativeClient()) return { visualPrefs, qualityPrefs };
    try {
        if (localStorage.getItem(IOS_NATIVE_FEEDBACK_INIT_KEY) === '1') {
            return { visualPrefs, qualityPrefs };
        }
        const nextVisual = { ...visualPrefs, enabled: true };
        const nextQuality = { ...qualityPrefs, mode: 'high' };
        saveVisualPrefs(nextVisual);
        saveQualityPrefs(nextQuality);
        audioFx?.setEnabled?.(true);
        audioFx?.setHaptic?.(true);
        localStorage.setItem(IOS_NATIVE_FEEDBACK_INIT_KEY, '1');
        return { visualPrefs: nextVisual, qualityPrefs: nextQuality };
    } catch {
        return {
            visualPrefs: { ...visualPrefs, enabled: true },
            qualityPrefs: { ...qualityPrefs, mode: 'high' },
        };
    }
}

function loadVisualPrefs() {
    if (isLowEndAndroidClient()) return { enabled: false };
    try {
        const raw = localStorage.getItem(VISUAL_STORAGE_KEY);
        if (!raw) {
            return { ...DEFAULT_VISUAL_PREFS };
        }
        return { ...DEFAULT_VISUAL_PREFS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_VISUAL_PREFS };
    }
}

function saveVisualPrefs(prefs) {
    try {
        localStorage.setItem(VISUAL_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        /* ignore */
    }
}

function loadQualityPrefs() {
    if (isLowEndAndroidClient()) return { mode: 'low' };
    try {
        const raw = localStorage.getItem(QUALITY_STORAGE_KEY);
        const prefs = raw ? { ...DEFAULT_QUALITY_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_QUALITY_PREFS };
        return QUALITY_MODES.includes(prefs.mode) ? prefs : { ...DEFAULT_QUALITY_PREFS };
    } catch {
        return { ...DEFAULT_QUALITY_PREFS };
    }
}

function saveQualityPrefs(prefs) {
    try {
        localStorage.setItem(QUALITY_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        /* ignore */
    }
}

function setButtonState(button, { enabled, onIcon, offIcon, onLabel, offLabel }) {
    if (!button) return;
    button.textContent = enabled ? onIcon : offIcon;
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? `关闭${onLabel}` : `开启${onLabel}`);
    button.title = `${onLabel}：${enabled ? '开' : '关'}`;
    if (offLabel) {
        button.dataset.offLabel = offLabel;
    }
}

export function initFeedbackToggles({ game, audioFx, ambient } = {}) {
    const visualBtn = document.getElementById('visual-effects-toggle');
    const qualityBtn = document.getElementById('quality-toggle');
    const soundBtn = document.getElementById('sound-effects-toggle');
    const normalized = normalizeIOSNativeFeedbackPrefs(loadVisualPrefs(), loadQualityPrefs(), audioFx);
    const visualPrefs = normalized.visualPrefs;
    const qualityPrefs = normalized.qualityPrefs;

    const applyVisual = (enabled, { persist = true } = {}) => {
        const on = !!enabled;
        game?.renderer?.setEffectsEnabled?.(on);
        ambient?.setEnabled?.(on);
        if (!on) {
            game?.renderer?.clearFx?.();
        }
        if (persist) saveVisualPrefs({ enabled: on });
        setButtonState(visualBtn, {
            enabled: on,
            onIcon: '✨',
            offIcon: '✦',
            onLabel: '视觉特效',
            offLabel: '视觉特效',
        });
        game?.markDirty?.();
    };

    const applySound = (enabled) => {
        const on = !!enabled;
        audioFx?.setEnabled?.(on);
        /* v1.61.9：音效开关同时控制触觉反馈（消行震动等）。
         * 之前 prefs.sound 和 prefs.haptic 是分开的两个开关，UI 上只暴露音效一个，
         * 导致用户开音效时震动可能因为历史 haptic=false 不响应。统一控制更直观。 */
        audioFx?.setHaptic?.(on);
        setButtonState(soundBtn, {
            enabled: on,
            onIcon: '🔊',
            offIcon: '🔇',
            onLabel: '音效与振动',
            offLabel: '音效与振动',
        });
    };

    const applyQuality = (mode, { persist = true } = {}) => {
        const next = QUALITY_MODES.includes(mode) ? mode : DEFAULT_QUALITY_PREFS.mode;
        game?.renderer?.setQualityMode?.(next);
        const root = document.documentElement;
        root.classList.remove('quality-high', 'quality-balanced', 'quality-low');
        root.classList.add(`quality-${next}`);
        if (persist) saveQualityPrefs({ mode: next });

        const meta = {
            high: { icon: '🌈', label: '高画质 · 动态', aria: '切换画质：当前高画质，动态背景开启' },
            balanced: { icon: '⚖️', label: '均衡画质', aria: '切换画质：当前均衡画质' },
            low: { icon: '🔋', label: '省电画质', aria: '切换画质：当前省电画质' },
        }[next];
        if (qualityBtn) {
            qualityBtn.textContent = meta.icon;
            qualityBtn.dataset.quality = next;
            qualityBtn.setAttribute('aria-pressed', next !== 'low' ? 'true' : 'false');
            qualityBtn.setAttribute('aria-label', meta.aria);
            qualityBtn.title = `画质：${meta.label}`;
        }
        game?.markDirty?.();
    };

    applyVisual(Boolean(visualPrefs.enabled), { persist: false });
    applyQuality(qualityPrefs.mode, { persist: false });
    applySound(audioFx?.getPrefs?.().sound !== false);

    visualBtn?.addEventListener('click', () => {
        const next = !(game?.renderer?.getEffectsEnabled?.() ?? true);
        applyVisual(next);
        if (audioFx?.getPrefs?.().sound !== false) {
            audioFx.play?.('tick', { force: true });
        }
    });

    soundBtn?.addEventListener('click', () => {
        const next = audioFx?.getPrefs?.().sound === false;
        applySound(next);
        if (next) {
            audioFx?.play?.('tick', { force: true });
        }
    });

    qualityBtn?.addEventListener('click', () => {
        const current = game?.renderer?.getQualityMode?.() || loadQualityPrefs().mode;
        const next = QUALITY_MODES[(QUALITY_MODES.indexOf(current) + 1) % QUALITY_MODES.length];
        applyQuality(next);
        if (audioFx?.getPrefs?.().sound !== false) {
            audioFx.play?.('tick', { force: true });
        }
    });

    return {
        setVisualEffectsEnabled: applyVisual,
        setSoundEnabled: applySound,
        setQualityMode: applyQuality,
        getVisualPrefs: () => loadVisualPrefs(),
        getQualityPrefs: () => loadQualityPrefs(),
    };
}
