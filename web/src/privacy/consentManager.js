import { safeWriteJson } from '../lib/storageAdapter.js';
/**
 * consentManager.js — 隐私同意 CMP + 未成年人策略（CS-3）
 *
 * - 同意分类：analytics（埋点）/ ads_personalization（个性化广告）/ functional（必要）。
 * - 未成年人：开启 minorMode 后强制关闭个性化广告 + 限制行为采集（合规）。
 * - 决策纯函数可测；`showConsentBanner` 渲染极简 CMP 弹层。
 */

const LS_KEY = 'openblock_consent_v1';

export const CONSENT_CATEGORIES = ['functional', 'analytics', 'ads_personalization'];

/** 默认同意态：必要功能默认开，其他默认关（opt-in，符合 GDPR/PIPL）。 */
export function defaultConsent() {
    return { functional: true, analytics: false, ads_personalization: false, minor: false, ts: 0 };
}

/** 应用未成年人策略：minor=true 时强制关闭个性化广告与埋点。 */
export function applyMinorPolicy(consent) {
    if (!consent.minor) return consent;
    return { ...consent, analytics: false, ads_personalization: false };
}

/** 某类目是否被允许（自动叠加未成年人策略）。 */
export function isAllowed(consent, category) {
    const c = applyMinorPolicy(consent || defaultConsent());
    if (category === 'functional') return true;
    return Boolean(c[category]);
}

export function loadConsent() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) return { ...defaultConsent(), ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return defaultConsent();
}

export function saveConsent(consent) {
    const next = applyMinorPolicy({ ...defaultConsent(), ...consent, ts: Date.now() });
    safeWriteJson(LS_KEY, next);
    return next;
}

/** 是否需要弹 CMP（尚未做过选择）。 */
export function needsConsent() {
    return !loadConsent().ts;
}

/** 极简 CMP 弹层（仅在 needsConsent 时调用）。回调返回最终同意态。 */
export function showConsentBanner(onDecided) {
    if (typeof document === 'undefined') return;
    if (document.getElementById('cmp-banner')) return;
    const el = document.createElement('div');
    el.id = 'cmp-banner';
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:100000;background:#0f172a;color:#e2e8f0;padding:16px;border-top:1px solid #334155;font-size:13px';
    el.innerHTML = `
      <div style="max-width:640px;margin:0 auto">
        <div style="margin-bottom:10px">我们使用 Cookie/本地存储以提供必要功能，并在您同意后用于数据分析与个性化广告。
          <a href="/docs.html" target="_blank" style="color:#5B9BD5">隐私政策</a></div>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="cmp-analytics"> 允许数据分析</label>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="cmp-ads"> 允许个性化广告</label>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="cmp-minor"> 我未满 18 周岁（将关闭个性化与分析）</label>
        <div style="margin-top:10px;text-align:right">
          <button id="cmp-reject" style="margin-right:8px;padding:6px 14px;background:#334155;color:#e2e8f0;border:none;border-radius:6px">仅必要</button>
          <button id="cmp-accept" style="padding:6px 14px;background:#f59e0b;color:#fff;border:none;border-radius:6px">保存</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    const minorCb = el.querySelector('#cmp-minor');
    const analyticsCb = el.querySelector('#cmp-analytics');
    const adsCb = el.querySelector('#cmp-ads');
    minorCb.addEventListener('change', () => {
        if (minorCb.checked) { analyticsCb.checked = false; adsCb.checked = false; analyticsCb.disabled = true; adsCb.disabled = true; }
        else { analyticsCb.disabled = false; adsCb.disabled = false; }
    });
    const finish = (consent) => { el.remove(); const saved = saveConsent(consent); onDecided?.(saved); };
    el.querySelector('#cmp-reject').onclick = () => finish({ analytics: false, ads_personalization: false, minor: minorCb.checked });
    el.querySelector('#cmp-accept').onclick = () => finish({
        analytics: analyticsCb.checked, ads_personalization: adsCb.checked, minor: minorCb.checked,
    });
}
