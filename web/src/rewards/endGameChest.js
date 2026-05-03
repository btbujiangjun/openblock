/**
 * endGameChest.js — v10.16 局末宝箱（P1）
 *
 * 装饰 game.endGame()，5% 基础概率随机弹宝箱（含「保底」和「热度调节」），
 * 奖励为各类道具 token / 试穿券 / coin。
 *
 * 概率与保底规则
 * --------------
 * - **基础**：每局 5% 触发
 * - **保底**：连续 12 局未触发，第 13 局必出（防低概率挫败）
 * - **热度**：score ≥ 800 概率 +5%（让"打得好"也有反馈）
 *
 * 奖励等级（按权重抽取，加权一次性发放）
 * --------------------------------------
 * - 普通（70%）：1× 提示券 / 1× 撤销
 * - 稀有（25%）：2× 提示券 / 1× 炸弹 / 1× 彩虹
 * - 史诗（5%）：5× 提示券 + 1× 炸弹 + 1× 彩虹 + 12h 试穿券
 *
 * 入账时机（v10.18.7）
 * --------------------
 * 命中后只写入 `pendingChest` 并弹层；用户点击「领取到钱包」或点遮罩关闭时再入账。
 * 下一局结算或 init 时会先兑现未领的 pending，避免关页/未点导致丢奖。
 * 详见 docs/product/CHEST_AND_WALLET.md。
 */

import { getWallet } from '../skills/wallet.js';
import { SKINS } from '../skins.js';

const STATE_KEY = 'openblock_chest_state_v1';

const TIER_WEIGHTS = [
    { tier: 'common',  w: 70 },
    { tier: 'rare',    w: 25 },
    { tier: 'epic',    w: 5 },
];

const TIER_REWARDS = {
    common: [
        { hintToken: 1 },
        { undoToken: 1 },
    ],
    rare: [
        { hintToken: 2 },
        { bombToken: 1 },
        { rainbowToken: 1 },
    ],
    epic: [
        { hintToken: 5, bombToken: 1, rainbowToken: 1, _trial: true },
    ],
};

const TRIAL_SKIN_POOL = ['forbidden', 'demon', 'fairy', 'aurora', 'industrial', 'mahjong'];

function _load() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); }
    catch { return {}; }
}
function _save(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

/**
 * 兑现上一局未确认的局末宝箱（幂等；入账后清除 pendingChest）。
 */
function _fulfillPendingChestGrant() {
    const s = _load();
    const p = s.pendingChest;
    if (!p || !p.tier || !p.reward) return;
    const reward = { ...p.reward };
    _grantReward(reward, p.tier);
    delete s.pendingChest;
    _save(s);
}

let _origEndGame = null;
let _audio = null;

export function initEndGameChest({ game, audio = null } = {}) {
    if (!game || _origEndGame) return;
    _audio = audio;

    try { _fulfillPendingChestGrant(); } catch (e) { console.warn('[chest] pending flush', e); }

    _origEndGame = game.endGame.bind(game);
    game.endGame = async (...args) => {
        const ret = await _origEndGame(...args);
        try { _maybeOpenChest(game); } catch (e) { console.warn('[chest]', e); }
        return ret;
    };
}

function _maybeOpenChest(game) {
    _fulfillPendingChestGrant();

    const state = _load();
    const sinceLast = (state.gamesSinceChest | 0) + 1;
    const score = game.score | 0;

    let prob = 0.05;
    if (score >= 800) prob += 0.05;
    if (sinceLast >= 12) prob = 1.0;     // 保底

    if (Math.random() > prob) {
        state.gamesSinceChest = sinceLast;
        _save(state);
        return;
    }

    state.gamesSinceChest = 0;
    state.totalChests = (state.totalChests | 0) + 1;
    const tier = _pickTier();
    const reward = _pickReward(tier);
    state.pendingChest = { tier, reward: { ...reward } };
    _save(state);
    _showChestModal(tier, state.pendingChest.reward);
}

function _pickTier() {
    const total = TIER_WEIGHTS.reduce((s, x) => s + x.w, 0);
    let rnd = Math.random() * total;
    for (const t of TIER_WEIGHTS) {
        rnd -= t.w;
        if (rnd < 0) return t.tier;
    }
    return 'common';
}

function _pickReward(tier) {
    const pool = TIER_REWARDS[tier] || TIER_REWARDS.common;
    const r = pool[Math.floor(Math.random() * pool.length)];
    return { ...r };
}

function _grantReward(reward, tier) {
    const wallet = getWallet();
    for (const [k, v] of Object.entries(reward)) {
        if (k.startsWith('_')) continue;
        wallet.addBalance(k, v, `chest-${tier}`);
    }
    if (reward._trial) {
        const pool = TRIAL_SKIN_POOL.filter(id => SKINS[id]);
        if (pool.length) {
            const chosen = pool[Math.floor(Math.random() * pool.length)];
            wallet.addTrial(chosen, 12);
            reward._trialSkin = chosen;
        }
    }
}

function _formatReward(reward) {
    const parts = [];
    if (reward.hintToken) parts.push(`+${reward.hintToken} 提示券`);
    if (reward.undoToken) parts.push(`+${reward.undoToken} 撤销`);
    if (reward.bombToken) parts.push(`+${reward.bombToken} 炸弹`);
    if (reward.rainbowToken) parts.push(`+${reward.rainbowToken} 彩虹`);
    if (reward._trialSkin) parts.push(`12h 试穿 ${SKINS[reward._trialSkin]?.name || reward._trialSkin}`);
    return parts.join(' · ');
}

/** 弹层展示用（入账前 epic 尚无 _trialSkin） */
function _formatRewardDisplay(reward) {
    let line = _formatReward(reward);
    if (reward._trial && !reward._trialSkin) {
        line = line ? `${line} · 12h 随机试穿` : '12h 随机试穿';
    }
    return line;
}

/**
 * v10.18.6：结算卡（#game-over.active）显示期间不能叠加 chest 浮层，否则与玻璃卡片同时
 * 出现两次浮层。改为延迟到玩家离开结算卡（点击 再来一局 / 菜单）之后再弹。
 */
function _showChestModal(tier, reward) {
    if (typeof document === 'undefined') return;
    const overEl = document.getElementById('game-over');
    if (overEl?.classList.contains('active')) {
        _afterGameOverDismiss(overEl, () => _renderChestModal(tier, reward));
        return;
    }
    _renderChestModal(tier, reward);
}

function _afterGameOverDismiss(overEl, action) {
    const obs = new MutationObserver(() => {
        if (!overEl.classList.contains('active')) {
            obs.disconnect();
            // 让下一屏稳定一帧再弹
            setTimeout(action, 80);
        }
    });
    obs.observe(overEl, { attributes: true, attributeFilter: ['class'] });
}

function _dismissChestPanel(panel) {
    try { _fulfillPendingChestGrant(); } catch (e) { console.warn('[chest]', e); }
    panel.classList.remove('is-visible');
}

function _renderChestModal(tier, reward) {
    let panel = document.getElementById('chest-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'chest-panel';
        panel.className = 'chest-panel';
        document.body.appendChild(panel);
    }
    const tierLabel = { common: '普通', rare: '稀有', epic: '史诗' }[tier] || '普通';
    const tierIcon = { common: '🎁', rare: '🎀', epic: '🏆' }[tier];
    panel.innerHTML = `
        <div class="chest-card chest-card--${tier}">
            <div class="chest-icon">${tierIcon}</div>
            <h3 class="chest-title">${tierLabel}宝箱</h3>
            <div class="chest-reward">${_formatRewardDisplay(reward)}</div>
            <p class="chest-hint">点击下方按钮或空白处关闭，奖励将发放至钱包</p>
            <button type="button" class="chest-claim-btn">领取到钱包</button>
        </div>
    `;
    panel.classList.add('is-visible');
    panel.querySelector('.chest-claim-btn').addEventListener('click', () => _dismissChestPanel(panel));
    panel.addEventListener('click', (e) => {
        if (e.target === panel) _dismissChestPanel(panel);
    });
    _audio?.play?.('unlock');
    _audio?.vibrate?.([40, 60, 40]);
}

export const __test_only__ = { TIER_WEIGHTS, TIER_REWARDS, _fulfillPendingChestGrant, _formatRewardDisplay };
