/**
 * bgmStub.js — v10.16 BGM 主题循环（P2 骨架）
 *
 * 大工程占位：每款主题独立 BGM（钢琴 / 自然环境音 / 8-bit chiptune 等）。
 *
 * 当前实施
 * --------
 * - 仅提供 API 占位，便于后续接入实际音频资源
 * - 利用 Web Audio AudioBufferSourceNode + GainNode 即可实现 cross-fade
 * - 因需音频资产（OGG / MP3，30s 循环每款 ~150KB × 36 款 ≈ 5MB），暂不内置
 *
 * 待实施 TODO
 * -----------
 * 1. 在 web/public/bgm/ 下按皮肤 id 放置 30s loop 的 OGG（需音频制作）
 * 2. 实现 _loadAndCrossFade(skinId, prevSkinId)
 * 3. 接入 onSkinAfterApply
 * 4. 用户偏好：BGM 总开关 + 音量
 *
 * 接入路径
 * --------
 *   import { initBgm } from './effects/bgmStub.js';
 *   initBgm({ audioFx });   // 当前仅 noop，正式实施后接入
 */

const STORAGE_KEY = 'openblock_bgm_v1';

const PREFS_DEFAULT = { enabled: false, volume: 0.4 };

function _load() {
    try { return { ...PREFS_DEFAULT, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')) }; }
    catch { return { ...PREFS_DEFAULT }; }
}
function _save(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

let _initialized = false;
let _prefs = null;

export function initBgm() {
    if (_initialized) return;
    _initialized = true;
    _prefs = _load();
    if (typeof window !== 'undefined') {
        window.__bgm = {
            getPrefs: () => ({ ..._prefs }),
            setEnabled(b) { _prefs.enabled = !!b; _save(_prefs); console.info('[BGM] enabled:', _prefs.enabled, '(stub: actual audio not loaded)'); },
            setVolume(v)  { _prefs.volume = Math.max(0, Math.min(1, +v || 0)); _save(_prefs); },
            isImplemented: () => false,
        };
    }
    console.info('[BGM stub] initialized — actual audio assets pending. See bgmStub.js TODO.');
}
