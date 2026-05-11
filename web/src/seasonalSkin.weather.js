/**
 * seasonalSkin.weather.js — v10.16 天气感知换皮（P2 骨架）
 *
 * 通过 open-meteo 免费 API（无 key）获取本地天气，雨天推荐 koi、雪天推荐 fairy（雪地）。
 *
 * 当前实施
 * --------
 * - 仅提供 API 占位 + 天气 → 皮肤的映射表
 * - 实际生效需 navigator.geolocation 权限请求和网络调用
 * - 隐私护栏：用户必须在设置中显式开启「天气感知」（默认关闭）
 *
 * 待实施 TODO
 * -----------
 * 1. UI 设置面板加「启用天气感知」开关
 * 2. 调 navigator.geolocation.getCurrentPosition()
 * 3. 调 https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}&current=weather_code
 * 4. 根据 weather_code 映射皮肤（雨 51-67 → koi / 雪 71-77 → fairy / 晴 0-3 → ocean）
 * 5. 当日只查一次（localStorage 缓存）
 */

const STORAGE_KEY = 'openblock_weather_v1';

const WEATHER_TO_SKIN = {
    /* WMO Weather Code → 皮肤 */
    rain:    'koi',          // 51-67
    snow:    'fairy',        // 71-77 (用 fairy 替代不存在的 winter)
    storm:   'sunset',       // 95-99（v10.32 lava 合并入 sunset / 琥珀流光）
    fog:     'sakura',       // 45-48
    clear:   'ocean',        // 0-3
    cloudy:  'aurora',       // 4-9
};

function isWeatherSenseEnabled() {
    try { return localStorage.getItem(STORAGE_KEY + '_optin') === '1'; }
    catch { return false; }
}

function setWeatherSenseEnabled(b) {
    try { localStorage.setItem(STORAGE_KEY + '_optin', b ? '1' : '0'); }
    catch { /* ignore */ }
}

export function initWeatherStub() {
    if (typeof window !== 'undefined') {
        window.__weatherSkin = {
            isEnabled: isWeatherSenseEnabled,
            setEnabled: setWeatherSenseEnabled,
            mapping: WEATHER_TO_SKIN,
            isImplemented: () => false,
            /* 真实实现：调用 open-meteo + geolocation 后命中映射皮肤 */
            recommend: () => null,
        };
    }
    console.info('[weatherStub] initialized — geolocation + open-meteo integration pending.');
}

export const __test_only__ = { WEATHER_TO_SKIN };
