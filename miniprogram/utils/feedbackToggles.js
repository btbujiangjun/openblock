/**
 * 小程序版"特效 / 画质"偏好与开关。
 *
 * 与 web/src/feedbackToggles.js 严格对齐：
 *   - localStorage Key 完全一致（'openblock_visualfx_v1' / 'openblock_quality_v1'），
 *     方便未来多端账号同步直接复用同一份 schema。
 *   - 画质三档：high / balanced / low（与 web 一致）。
 *   - 视觉特效：enabled true/false（关闭时所有粒子/抖动/闪光均被 renderer 守卫拒绝）。
 *
 * 不同点：
 *   - 小程序 storage 走 wx.setStorageSync（adapters/storage 已封装为 localStorage 接口）。
 *   - 不直接操作 DOM/根节点 class（小程序无 root.classList）；改为返回当前模式让页面 setData。
 */

const storage = require('../adapters/storage');

const VISUAL_STORAGE_KEY = 'openblock_visualfx_v1';
const QUALITY_STORAGE_KEY = 'openblock_quality_v1';

const DEFAULT_VISUAL_PREFS = { enabled: true };
const DEFAULT_QUALITY_PREFS = { mode: 'high' };
const QUALITY_MODES = ['high', 'balanced', 'low'];

const QUALITY_META = {
  high: { icon: '🌈', labelKey: 'qualityHigh' },
  balanced: { icon: '⚖️', labelKey: 'qualityBalanced' },
  low: { icon: '🔋', labelKey: 'qualityLow' },
};

const VISUAL_META = {
  on: { icon: '✨', labelKey: 'visualOn' },
  off: { icon: '✦', labelKey: 'visualOff' },
};

function loadVisualPrefs() {
  try {
    const raw = storage.getItem(VISUAL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VISUAL_PREFS };
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...DEFAULT_VISUAL_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_VISUAL_PREFS };
  }
}

function saveVisualPrefs(prefs) {
  try {
    storage.setItem(VISUAL_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

function loadQualityPrefs() {
  try {
    const raw = storage.getItem(QUALITY_STORAGE_KEY);
    const parsed = raw
      ? { ...DEFAULT_QUALITY_PREFS, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) }
      : { ...DEFAULT_QUALITY_PREFS };
    return QUALITY_MODES.includes(parsed.mode) ? parsed : { ...DEFAULT_QUALITY_PREFS };
  } catch {
    return { ...DEFAULT_QUALITY_PREFS };
  }
}

function saveQualityPrefs(prefs) {
  try {
    storage.setItem(QUALITY_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/**
 * 创建偏好控制器。renderer/audioFx 可选；任何一个缺失时只更新偏好与展示状态。
 *
 * @param {Object} opts
 * @param {Object} [opts.renderer] - GameRenderer 实例
 * @param {(state: { visualEnabled: boolean, qualityMode: string }) => void} [opts.onChange]
 *   每次状态变更回调（用于页面 setData 同步图标/aria 等）。
 * @returns {{
 *   getState(): { visualEnabled: boolean, qualityMode: string },
 *   getQualityMeta(): { icon: string, labelKey: string },
 *   getVisualMeta(): { icon: string, labelKey: string },
 *   setVisualEnabled(enabled: boolean, opts?: { persist?: boolean }): void,
 *   toggleVisual(): boolean,
 *   setQualityMode(mode: string, opts?: { persist?: boolean }): void,
 *   cycleQualityMode(): string,
 * }}
 */
function createFeedbackToggles({ renderer, onChange } = {}) {
  let visualEnabled = !!loadVisualPrefs().enabled;
  let qualityMode = loadQualityPrefs().mode;
  if (!QUALITY_MODES.includes(qualityMode)) qualityMode = 'high';

  const emit = () => {
    if (typeof onChange === 'function') {
      onChange({ visualEnabled, qualityMode });
    }
  };

  const applyVisual = (enabled, { persist = true } = {}) => {
    visualEnabled = !!enabled;
    renderer?.setEffectsEnabled?.(visualEnabled);
    if (!visualEnabled) renderer?.clearFx?.();
    if (persist) saveVisualPrefs({ enabled: visualEnabled });
    emit();
  };

  const applyQuality = (mode, { persist = true } = {}) => {
    const next = QUALITY_MODES.includes(mode) ? mode : 'high';
    qualityMode = next;
    renderer?.setQualityMode?.(next);
    if (persist) saveQualityPrefs({ mode: next });
    emit();
  };

  /* 初始化时应用一次到 renderer，但不重复持久化。 */
  applyVisual(visualEnabled, { persist: false });
  applyQuality(qualityMode, { persist: false });

  return {
    getState: () => ({ visualEnabled, qualityMode }),
    getQualityMeta: () => QUALITY_META[qualityMode] || QUALITY_META.high,
    getVisualMeta: () => (visualEnabled ? VISUAL_META.on : VISUAL_META.off),

    setVisualEnabled: applyVisual,
    toggleVisual() {
      applyVisual(!visualEnabled);
      return visualEnabled;
    },

    setQualityMode: applyQuality,
    cycleQualityMode() {
      const idx = QUALITY_MODES.indexOf(qualityMode);
      const next = QUALITY_MODES[(idx + 1) % QUALITY_MODES.length];
      applyQuality(next);
      return next;
    },
  };
}

module.exports = {
  QUALITY_MODES,
  QUALITY_META,
  VISUAL_META,
  loadVisualPrefs,
  saveVisualPrefs,
  loadQualityPrefs,
  saveQualityPrefs,
  createFeedbackToggles,
};
