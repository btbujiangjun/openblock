/**
 * localStorageStateSync.js — v1.52
 *
 * 目标：
 * - 按业务主题把 localStorage 持久化到 SQLite 分区表（core/monetization/social/preferences/experiment）
 * - 根据更新机制差异控制同步频率：核心进度快、偏好配置慢
 * - 启动时做“防回滚合并”：远端只补齐本地缺项，本地已有值优先
 */
import { getApiBaseUrl, isSqliteClientDatabase } from './config.js';

const SECTION_INTERVAL_MS = {
    core: 5000,
    monetization: 8000,
    social: 12000,
    preferences: 30000,
    experiment: 20000,
};
const SECTIONS = ['core', 'monetization', 'social', 'preferences', 'experiment'];

const LOCAL_ONLY_KEYS = new Set([
    'api_url',
    'openblock_checkin_debug_v1',
]);

const CORE_KEYS = new Set([
    'bb_user_id',
    'openblock_progression_v1',
    'openblock_player_profile',
    'openblock_rank_v1',
    'openblock_skill_wallet_v1',
    'openblock_checkin_v1',
    'openblock_login_streak_v1',
    'openblock_monthly_milestone_v1',
    'openblock_skin_fragments_v1',
    'openblock_skin',
    'openblock_best_score',
    /* v1.55 §4.4 + §4.7 + §4.11：PB 分桶 / 周期 / 跨设备同步 */
    'openblock_best_by_strategy_v1',
    'openblock_period_best_v1',
    'openblock_strategy',
    'openblock_season_pass',
]);

const MONETIZATION_KEYS = new Set([
    'openblock_mon_season_v1',
    'openblock_mon_task_points',
    'openblock_mon_daily_tasks_v1',
    'openblock_mon_purchases_v1',
    'openblock_mon_ads_removed',
    'openblock_promo_state_v1',
    'openblock_offer_toast_shown_v1',
    'openblock_first_purchase_v1',
    'openblock_first_day_pack_v1',
    'openblock_weekly_challenge_v1',
    'openblock_vip_system_v1',
    'openblock_ad_freq_v1',
    'openblock_ad_counts_v1',
    'openblock_chest_state_v1',
    'openblock_season_chest_v1',
    'openblock_lucky_wheel_v1',
    'openblock_mon_lb_lastSubmit',
]);

const SOCIAL_KEYS = new Set([
    'openblock_friends_v1',
    'openblock_guild_v1',
    'openblock_async_pk_v1',
    'openblock_replay_album_v1',
    'openblock_replay_milestones_v1',
    'openblock_daily_master_v1',
    'openblock_mini_goals',
    'openblock_social_intro_v1',
    'openblock_welcome_back_v1',
    'openblock_winback_v1',
    'openblock_companion_v1',
    'openblock_personal_stats_v1',
    'openblock_registration_v1',
    'openblock_year_review_v1',
]);

const PREFERENCES_KEYS = new Set([
    'openblock_audiofx_v1',
    'openblock_bgm_v1',
    'openblock_ambient_v1',
    'openblock_quality_v1',
    'openblock_visualfx_v1',
    'openblock_locale_v1',
    'openblock_push_prefs',
    'openblock_push_v1',
    'openblock_push_system_v1',
    'openblock_weather_v1',
    'openblock_rotation_mode_v1',
    'openblock_skin_user_chosen',
    'openblock_april_fools_optout',
    'openblock_user_birthday_v1',
    'openblock_weekend_trial_v1',
    'openblock_personalization_prefs_v1',
    'openblock_stress_breakdown_open_v1',
]);

const EXPERIMENT_KEYS = new Set([
    'openblock_ab_overrides',
    'openblock_ab_test_v1',
    'openblock_remote_config_v1',
    'openblock_linucb_state_v1',
    'openblock_drift_live_v1',
    'openblock_model_quality_v1',
    'openblock_action_outcome_matrix_v1',
    'openblock_retention_v1',
    'openblock_cohorts_v1',
    'openblock_churn_data_v1',
    'openblock_churn_signals_v1',
    'openblock_rl_panel_collapsed_v1',
    'openblock_spawn_warmup_v1',
    'custom_strategies',
    'levelProgression',
    'rl_use_pytorch',
]);

let _timer = null;
let _panelTimer = null;
let _monitorPanelEl = null;
let _monitorPanelAuto = false;
const _lastSectionSnapshotHash = {
    core: '',
    monetization: '',
    social: '',
    preferences: '',
    experiment: '',
};
const _lastSyncMeta = {
    core: { hash: '', ts: 0 },
    monetization: { hash: '', ts: 0 },
    social: { hash: '', ts: 0 },
    preferences: { hash: '', ts: 0 },
    experiment: { hash: '', ts: 0 },
};

const _monitor = {
    startedAt: 0,
    lastHydrateAt: 0,
    lastPushAt: 0,
    totalPushes: 0,
    totalErrors: 0,
    retryCount: 0,
    droppedByWhitelist: {},
    lastPushReason: '',
    sections: {
        core: { lastChangeAt: 0, lastSyncAt: 0, pushCount: 0, skipCount: 0, errorCount: 0, changedKeyCount: 0, lastPayloadSize: 0, lastError: '' },
        monetization: { lastChangeAt: 0, lastSyncAt: 0, pushCount: 0, skipCount: 0, errorCount: 0, changedKeyCount: 0, lastPayloadSize: 0, lastError: '' },
        social: { lastChangeAt: 0, lastSyncAt: 0, pushCount: 0, skipCount: 0, errorCount: 0, changedKeyCount: 0, lastPayloadSize: 0, lastError: '' },
        preferences: { lastChangeAt: 0, lastSyncAt: 0, pushCount: 0, skipCount: 0, errorCount: 0, changedKeyCount: 0, lastPayloadSize: 0, lastError: '' },
        experiment: { lastChangeAt: 0, lastSyncAt: 0, pushCount: 0, skipCount: 0, errorCount: 0, changedKeyCount: 0, lastPayloadSize: 0, lastError: '' },
    },
};

function _getUserId() {
    let userId = localStorage.getItem('bb_user_id');
    if (!userId) {
        userId = `u${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        localStorage.setItem('bb_user_id', userId);
    }
    return userId;
}

function _api(path, options = {}) {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    return fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    }).then(async (res) => {
        const text = await res.text();
        let data = null;
        if (text) {
            try { data = JSON.parse(text); } catch { data = { _raw: text }; }
        }
        if (!res.ok) {
            const err = new Error(data?.error || `HTTP ${res.status} ${path}`);
            err.status = res.status;
            throw err;
        }
        return data;
    });
}

function _sectionForKey(key) {
    if (!key || LOCAL_ONLY_KEYS.has(key)) return null;
    if (CORE_KEYS.has(key)) return 'core';
    if (MONETIZATION_KEYS.has(key) || key.startsWith('openblock_mon_') || key.startsWith('offer_') || key.startsWith('stripe_')) return 'monetization';
    if (SOCIAL_KEYS.has(key)) return 'social';
    if (PREFERENCES_KEYS.has(key)) return 'preferences';
    if (EXPERIMENT_KEYS.has(key)) return 'experiment';
    if (key.startsWith('openblock_')) return 'core'; // 兜底：未知 openblock_* 也纳入核心备份
    return null;
}

function _stableHash(obj) {
    const keys = Object.keys(obj).sort();
    const packed = {};
    for (const k of keys) packed[k] = obj[k];
    return JSON.stringify(packed);
}

function _fmtTs(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleTimeString(); } catch { return String(ts); }
}

function _renderMonitorHtml() {
    const lines = [];
    lines.push(`<div><b>StateSync Monitor</b> · push:${_monitor.totalPushes} · retry:${_monitor.retryCount} · err:${_monitor.totalErrors}</div>`);
    lines.push(`<div>hydrate:${_fmtTs(_monitor.lastHydrateAt)} · lastPush:${_fmtTs(_monitor.lastPushAt)} · reason:${_monitor.lastPushReason || '—'}</div>`);
    lines.push('<hr style="border-color:#334155; margin:6px 0;">');
    for (const sec of SECTIONS) {
        const s = _monitor.sections[sec];
        lines.push(
            `<div><b>${sec}</b> chg:${s.changedKeyCount} push:${s.pushCount} skip:${s.skipCount} err:${s.errorCount} ` +
            `lastChange:${_fmtTs(s.lastChangeAt)} lastSync:${_fmtTs(s.lastSyncAt)} size:${s.lastPayloadSize}</div>`
        );
        if (s.lastError) lines.push(`<div style="color:#fca5a5;">↳ ${s.lastError}</div>`);
    }
    const droppedSections = Object.keys(_monitor.droppedByWhitelist || {});
    if (droppedSections.length) {
        lines.push('<hr style="border-color:#334155; margin:6px 0;">');
        lines.push('<div><b>dropped by whitelist</b></div>');
        for (const sec of droppedSections) {
            const arr = _monitor.droppedByWhitelist[sec] || [];
            lines.push(`<div>${sec}: ${arr.slice(0, 8).join(', ')}${arr.length > 8 ? ' ...' : ''}</div>`);
        }
    }
    return lines.join('');
}

function _ensureMonitorPanel() {
    if (_monitorPanelEl || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'state-sync-monitor-panel';
    el.style.cssText = [
        'position:fixed', 'right:10px', 'bottom:10px', 'z-index:10050',
        'max-width:460px', 'max-height:42vh', 'overflow:auto',
        'background:rgba(2,6,23,0.90)', 'color:#e2e8f0', 'font:12px/1.5 ui-monospace,Menlo,Consolas,monospace',
        'border:1px solid rgba(59,130,246,0.45)', 'border-radius:8px', 'padding:8px',
        'box-shadow:0 8px 24px rgba(0,0,0,0.45)',
    ].join(';');
    document.body.appendChild(el);
    _monitorPanelEl = el;
}

function _startPanelRenderLoop() {
    if (_panelTimer || typeof window === 'undefined') return;
    _panelTimer = window.setInterval(() => {
        if (!_monitorPanelEl) return;
        _monitorPanelEl.innerHTML = _renderMonitorHtml();
    }, 1000);
}

function _stopPanelRenderLoop() {
    if (!_panelTimer || typeof window === 'undefined') return;
    window.clearInterval(_panelTimer);
    _panelTimer = null;
}

function showStateSyncMonitorPanel() {
    _ensureMonitorPanel();
    if (_monitorPanelEl) _monitorPanelEl.innerHTML = _renderMonitorHtml();
    _startPanelRenderLoop();
}

function hideStateSyncMonitorPanel() {
    _stopPanelRenderLoop();
    if (_monitorPanelEl?.parentNode) _monitorPanelEl.parentNode.removeChild(_monitorPanelEl);
    _monitorPanelEl = null;
}

function _snapshotBySection() {
    const grouped = {
        core: {},
        monetization: {},
        social: {},
        preferences: {},
        experiment: {},
    };
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const section = _sectionForKey(key);
        if (!section) continue;
        const v = localStorage.getItem(key);
        if (v != null) grouped[section][key] = v;
    }
    return grouped;
}

function _mergeRemoteIntoLocal(remoteBundle) {
    if (!remoteBundle || typeof remoteBundle !== 'object') return false;
    const local = _snapshotBySection();
    let changed = false;
    for (const section of Object.keys(local)) {
        const remoteState = remoteBundle?.[section]?.state;
        if (!remoteState || typeof remoteState !== 'object') continue;
        for (const [k, v] of Object.entries(remoteState)) {
            if (localStorage.getItem(k) == null) {
                localStorage.setItem(k, String(v));
                changed = true;
            }
        }
    }
    return changed;
}

async function _pushChangedSections(force = false, reason = 'interval') {
    const userId = _getUserId();
    const now = Date.now();
    const snap = _snapshotBySection();
    const outgoing = {};
    for (const section of Object.keys(snap)) {
        const hash = _stableHash(snap[section]);
        const meta = _lastSyncMeta[section];
        const secMon = _monitor.sections[section];
        const prevHash = _lastSectionSnapshotHash[section];
        if (prevHash && prevHash !== hash) {
            secMon.lastChangeAt = now;
            secMon.changedKeyCount = Object.keys(snap[section] || {}).length;
        } else if (!prevHash && hash) {
            secMon.lastChangeAt = now;
            secMon.changedKeyCount = Object.keys(snap[section] || {}).length;
        }
        _lastSectionSnapshotHash[section] = hash;
        const due = now - meta.ts >= SECTION_INTERVAL_MS[section];
        if (force || (due && hash !== meta.hash)) {
            outgoing[section] = { state: snap[section], updatedAt: now };
            meta.hash = hash;
            meta.ts = now;
            secMon.lastPayloadSize = JSON.stringify(snap[section] || {}).length;
        } else {
            secMon.skipCount += 1;
        }
    }
    if (Object.keys(outgoing).length === 0) return;
    try {
        const res = await _api('/api/user-state-bundle', {
            method: 'PUT',
            body: JSON.stringify({ user_id: userId, bundle: outgoing }),
            keepalive: true,
        });
        _monitor.lastPushAt = now;
        _monitor.lastPushReason = reason;
        _monitor.totalPushes += 1;
        for (const sec of Object.keys(outgoing)) {
            const secMon = _monitor.sections[sec];
            secMon.pushCount += 1;
            secMon.lastSyncAt = now;
            secMon.lastError = '';
        }
        _monitor.droppedByWhitelist = res?.dropped && typeof res.dropped === 'object' ? res.dropped : {};
    } catch (e) {
        console.warn('[state-sync] push failed:', e);
        _monitor.totalErrors += 1;
        _monitor.retryCount += 1;
        for (const sec of Object.keys(outgoing)) {
            const secMon = _monitor.sections[sec];
            secMon.errorCount += 1;
            secMon.lastError = e?.message || String(e);
        }
    }
}

async function _hydrateFromServer() {
    const userId = _getUserId();
    try {
        const data = await _api(`/api/user-state-bundle?user_id=${encodeURIComponent(userId)}`);
        _monitor.lastHydrateAt = Date.now();
        const bundle = data?.bundle;
        const changed = _mergeRemoteIntoLocal(bundle);
        // 若远端有本地没有的键（新设备首次登录等场景），合并后主动回写，完成双端收敛。
        if (changed) await _pushChangedSections(true, 'hydrate-merge');
    } catch (e) {
        console.warn('[state-sync] hydrate failed:', e);
        _monitor.totalErrors += 1;
    }
}

export async function initLocalStorageStateSync() {
    if (typeof window === 'undefined' || !isSqliteClientDatabase()) return;
    _monitor.startedAt = Date.now();
    await _hydrateFromServer();
    await _pushChangedSections(true, 'init-full');
    if (_timer) clearInterval(_timer);
    _timer = setInterval(() => { void _pushChangedSections(false, 'interval'); }, 3000);
    window.addEventListener('beforeunload', () => { void _pushChangedSections(true, 'beforeunload'); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void _pushChangedSections(true, 'visibility-hidden');
    });
    window.__stateSyncMonitor = {
        show: () => showStateSyncMonitorPanel(),
        hide: () => hideStateSyncMonitorPanel(),
        toggle: () => (_monitorPanelEl ? hideStateSyncMonitorPanel() : showStateSyncMonitorPanel()),
        syncNow: async () => { await _pushChangedSections(true, 'manual'); },
        auto: (on = true) => {
            _monitorPanelAuto = !!on;
            if (_monitorPanelAuto) showStateSyncMonitorPanel();
            else hideStateSyncMonitorPanel();
        },
        snapshot: () => JSON.parse(JSON.stringify(_monitor)),
    };
    // 开发时可在控制台输入：window.__stateSyncMonitor.show()
    if (_monitorPanelAuto) {
        showStateSyncMonitorPanel();
    }
    window.addEventListener('storage', () => {
        // 跨标签页修改 localStorage 时，尽快触发一次强同步。
        void _pushChangedSections(true, 'storage-event');
    });
}

export const __test_only__ = {
    SECTIONS,
    SECTION_INTERVAL_MS,
    showStateSyncMonitorPanel,
    hideStateSyncMonitorPanel,
    _monitor,
    _sectionForKey,
    _snapshotBySection,
    _mergeRemoteIntoLocal,
    _stableHash,
};

