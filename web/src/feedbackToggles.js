const VISUAL_STORAGE_KEY = 'openblock_visualfx_v1';
const QUALITY_STORAGE_KEY = 'openblock_quality_v1';

const DEFAULT_VISUAL_PREFS = { enabled: true };
const DEFAULT_QUALITY_PREFS = { mode: 'high' };
const QUALITY_MODES = ['high', 'balanced', 'low'];

function loadVisualPrefs() {
    try {
        const raw = localStorage.getItem(VISUAL_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_VISUAL_PREFS };
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
    const visualPrefs = loadVisualPrefs();
    const qualityPrefs = loadQualityPrefs();

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
        setButtonState(soundBtn, {
            enabled: on,
            onIcon: '🔊',
            offIcon: '🔇',
            onLabel: '音效',
            offLabel: '音效',
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
