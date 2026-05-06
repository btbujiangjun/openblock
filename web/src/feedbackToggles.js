const VISUAL_STORAGE_KEY = 'openblock_visualfx_v1';

const DEFAULT_VISUAL_PREFS = { enabled: true };

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
    const soundBtn = document.getElementById('sound-effects-toggle');
    const visualPrefs = loadVisualPrefs();

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

    applyVisual(Boolean(visualPrefs.enabled), { persist: false });
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

    return {
        setVisualEffectsEnabled: applyVisual,
        setSoundEnabled: applySound,
        getVisualPrefs: () => loadVisualPrefs(),
    };
}
