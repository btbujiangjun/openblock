/**
 * companionStub.js — v10.16 角色养成 / 虚拟伙伴（P2 骨架，~8d 工程）
 *
 * 大工程占位：每款皮肤都有专属伙伴（pets 的小狗 / fairy 的精灵 / industrial 的机器人……），
 * 随等级长大，提供陪伴感。
 *
 * 当前实施
 * --------
 * - 仅提供 API 占位 + 部分伙伴的元数据（icon / 名字）
 * - 实际养成需要：等级模型 / 喂食消耗品 / 动画立绘 / 互动文案
 *
 * 待实施 TODO
 * -----------
 * 1. SVG / sprite-sheet 立绘资产（全量皮肤 × 5 个等级）
 * 2. 养成模型：每天进食 1 次 → +XP，level 0/3/7/15 解锁新立绘
 * 3. 互动 dialog：常见情绪反馈（开心 / 累 / 饿）
 * 4. 与游戏数据联动：连胜 +好感、长时间不玩 -饥饿值
 *
 * 接入路径
 * --------
 *   import { initCompanionStub } from './companion/companionStub.js';
 *   initCompanionStub();   // 当前仅 noop + console.info
 */

const COMPANIONS = {
    classic:    { icon: '⬛', name: '小方' },
    titanium:   { icon: '🔩', name: '钛粒' },
    neonCity:   { icon: '🌃', name: 'Cyb-3' },
    aurora:     { icon: '🌈', name: '极光' },
    ocean:      { icon: '🐋', name: '大蓝' },
    sunset:     { icon: '🌅', name: '余晖' },
    sakura:     { icon: '🌸', name: '小樱' },
    koi:        { icon: '🐟', name: '锦鲤' },
    candy:      { icon: '🍬', name: '糖糖' },
    pets:       { icon: '🐶', name: '阿黄' },
    universe:   { icon: '🌌', name: '星辰' },
    fantasy:    { icon: '🧝', name: '艾莉' },
    fairy:      { icon: '✨', name: '萤' },
    music:      { icon: '🎵', name: '音符' },
    industrial: { icon: '⚙️', name: '齿轮' },
    forbidden:  { icon: '🐲', name: '龙影' },
    mahjong:    { icon: '🀄', name: '中神' },
    boardgame:  { icon: '🃏', name: '小丑' },
    forest:     { icon: '🦌', name: '小鹿' },
    farm:       { icon: '🐄', name: '小牛' },
    pirate:     { icon: '🦜', name: '鹦鹉' },
    desert:     { icon: '🐫', name: '骆驼' },
    /* ……剩余 14 款由后续 sprint 补全 */
};

const STORAGE_KEY = 'openblock_companion_v1';

function _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
}

function getCompanion(skinId) {
    return COMPANIONS[skinId] || null;
}

export function initCompanionStub() {
    if (typeof window !== 'undefined') {
        window.__companion = {
            get: getCompanion,
            getState: _load,
            list: () => COMPANIONS,
            isImplemented: () => false,
        };
    }
    console.info('[companionStub] initialized — animation assets pending.');
}

export const __test_only__ = { COMPANIONS };
