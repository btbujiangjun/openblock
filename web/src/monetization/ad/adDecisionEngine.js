/**
 * AdDecisionEngine - 广告决策统一入口
 * 
 * 整合商业模型，统一的广告展示决策层
 * 场景化广告触发 + 智能频率控制
 */
import { buildCommercialModelVector, shouldAllowMonetizationAction } from '../commercialModel.js';
import { getStrategyConfig } from './strategy/index.js';
import { getPlayerAbilityModel } from '../../playerAbilityModel.js';
import { getAdAdapter } from './adAdapter.js';

const AD_SCENES = {
  GAME_OVER: 'game_over',           // 游戏结束
  LEVEL_COMPLETE: 'level_complete', // 关卡完成
  STAMINA_EMPTY: 'stamina_empty',   // 体力不足
  DAILY_REWARD: 'daily_reward',      // 每日奖励
  NO_MOVES: 'no_moves',             // 无步数
  SHOP_VIEW: 'shop_view',          // 商店查看
  PAUSE_MENU: 'pause_menu',        // 暂停菜单
  SETTINGS: 'settings'              // 设置页
};

const AD_TYPES = {
  REWARDED: 'rewarded',     // 激励广告（玩家主动观看）
  INTERSTITIAL: 'interstitial', // 插屏广告
  BANNER: 'banner'         // 横幅广告
};

class AdDecisionEngine {
  constructor() {
    this._sceneQueue = [];
    this._lastAdTime = 0;
    this._adCountToday = { rewarded: 0, interstitial: 0 };
    this._commercialVector = null;
    this._updateFrequency = 5000;
    this._lastUpdate = 0;
  }

  /**
   * 初始化广告决策引擎
   */
  init() {
    this._loadAdCounts();
    this._resetDailyIfNeeded();
    this._startFrequencyGuard();
    console.log('[AdEngine] Initialized');
  }

  /**
   * 获取商业模型向量（带缓存）
   */
  getCommercialVector(forceUpdate = false) {
    const now = Date.now();
    if (!forceUpdate && this._commercialVector && (now - this._lastUpdate) < this._updateFrequency) {
      return this._commercialVector;
    }

    const abilityModel = getPlayerAbilityModel();
    const config = getStrategyConfig();

    this._commercialVector = buildCommercialModelVector({
      persona: abilityModel.getPersona(),
      realtime: abilityModel.getRealtimeState(),
      ltv: abilityModel.getLTV(),
      adFreq: this._getAdFrequencyState(),
      config: { commercialModel: config.commercialModel }
    });

    this._lastUpdate = now;
    return this._commercialVector;
  }

  /**
   * 获取广告频率状态
   */
  _getAdFrequencyState() {
    const config = getStrategyConfig().commercialModel?.adFatigue ?? {};
    const now = Date.now();
    const timeSinceLastAd = now - this._lastAdTime;

    return {
      rewardedCount: this._adCountToday.rewarded,
      interstitialCount: this._adCountToday.interstitial,
      experienceScore: Math.max(0, 100 - (this._adCountToday.rewarded + this._adCountToday.interstitial * 5)),
      inRecoveryPeriod: timeSinceLastAd < (config.minIntervalMs ?? 60000)
    };
  }

  /**
   * 请求广告（场景化触发）
   * @param {string} scene 场景标识
   * @param {object} context 上下文数据
   * @returns {Promise<{allowed: boolean, adType: string, reason: string}>}
   */
  async requestAd(scene, context = {}) {
    const config = getStrategyConfig().commercialModel ?? {};
    const vector = this.getCommercialVector();
    const adAdapter = getAdAdapter();

    // Guardrail 检查
    if (!shouldAllowMonetizationAction(vector, 'interstitial') && !shouldAllowMonetizationAction(vector, 'rewarded')) {
      return { allowed: false, adType: null, reason: 'guardrail_suppressed', vector };
    }

    // 场景特定检查
    const sceneResult = await this._checkSceneSpecific(scene, context, vector, config);
    if (!sceneResult.allowed) {
      return sceneResult;
    }

    // 选择最佳广告类型
    const adType = this._selectBestAdType(scene, vector, config);
    
    // 频率检查
    if (!this._checkFrequency(adType, config)) {
      return { allowed: false, adType: null, reason: 'frequency_limit', vector };
    }

    // 尝试加载广告
    try {
      const loadResult = await adAdapter.loadAd(adType);
      if (loadResult.success) {
        this._recordAdShown(adType);
        return { 
          allowed: true, 
          adType, 
          reason: 'success',
          ad: loadResult.ad,
          vector
        };
      } else {
        return { allowed: false, adType, reason: 'ad_load_failed', detail: loadResult.error };
      }
    } catch (e) {
      console.warn('[AdEngine] Load ad error:', e);
      return { allowed: false, adType, reason: 'exception', detail: e.message };
    }
  }

  /**
   * 场景特定检查
   */
  async _checkSceneSpecific(scene, context, vector, config) {
    const thresholds = config.actionThresholds ?? {};

    switch (scene) {
      case AD_SCENES.GAME_OVER:
        // 只有低付费倾向用户才在游戏结束展示插屏
        if (vector.payerScore < (thresholds.lowPayerTask ?? 0.35)) {
          return { allowed: true, reason: 'ok', vector };
        }
        // 高付费用户只看激励广告
        if (vector.payerScore >= (thresholds.protectPayerScore ?? 0.68)) {
          if (shouldAllowMonetizationAction(vector, 'rewarded')) {
            return { allowed: true, adType: AD_TYPES.REWARDED, reason: 'payer_protected', vector };
          }
          return { allowed: false, reason: 'payer_protected_no_rewarded', vector };
        }
        return { allowed: true, reason: 'ok', vector };

      case AD_SCENES.NO_MOVES:
        // 无步数时优先激励广告（给玩家额外机会）
        if (shouldAllowMonetizationAction(vector, 'rewarded')) {
          return { allowed: true, adType: AD_TYPES.REWARDED, reason: 'no_moves_rewarded', vector };
        }
        return { allowed: false, reason: 'no_moves_no_rewarded', vector };

      case AD_SCENES.DAILY_REWARD:
        // 每日奖励时展示激励广告（用户主动）
        if (shouldAllowMonetizationAction(vector, 'rewarded')) {
          return { allowed: true, adType: AD_TYPES.REWARDED, reason: 'daily_reward', vector };
        }
        return { allowed: false, reason: 'daily_reward_no_rewarded', vector };

      case AD_SCENES.STAMINA_EMPTY:
        // 体力不足时激励广告
        if (shouldAllowMonetizationAction(vector, 'rewarded')) {
          return { allowed: true, adType: AD_TYPES.REWARDED, reason: 'stamina_empty', vector };
        }
        return { allowed: false, reason: 'stamina_empty_no_rewarded', vector };

      default:
        return { allowed: true, reason: 'ok', vector };
    }
  }

  /**
   * 选择最佳广告类型
   */
  _selectBestAdType(scene, vector, config) {
    const thresholds = config.actionThresholds ?? {};

    // 优先激励广告（用户主动，转化高）
    if (shouldAllowMonetizationAction(vector, 'rewarded')) {
      // 特定场景优先激励
      if ([AD_SCENES.NO_MOVES, AD_SCENES.DAILY_REWARD, AD_SCENES.STAMINA_EMPTY].includes(scene)) {
        return AD_TYPES.REWARDED;
      }
      // 高激励倾向也优先
      if (vector.rewardedAdPropensity >= (thresholds.rewardedRecommend ?? 0.55)) {
        return AD_TYPES.REWARDED;
      }
    }

    // 插屏广告检查
    if (shouldAllowMonetizationAction(vector, 'interstitial')) {
      // 低流失、低广告疲劳用户可展示插屏
      if (vector.interstitialPropensity >= (thresholds.interstitialRecommend ?? 0.5)) {
        return AD_TYPES.INTERSTITIAL;
      }
    }

    // 默认激励广告
    return AD_TYPES.REWARDED;
  }

  /**
   * 频率检查
   */
  _checkFrequency(adType, config) {
    const fatigueCfg = config.adFatigue ?? {};
    const now = Date.now();

    // 检查间隔
    const minInterval = fatigueCfg.minIntervalMs ?? 60000;
    if (now - this._lastAdTime < minInterval) {
      return false;
    }

    // 检查每日上限
    const dailyLimit = adType === AD_TYPES.REWARDED 
      ? (fatigueCfg.rewardedMax ?? 12)
      : (fatigueCfg.interstitialMax ?? 6);

    const count = adType === AD_TYPES.REWARDED 
      ? this._adCountToday.rewarded 
      : this._adCountToday.interstitial;

    return count < dailyLimit;
  }

  /**
   * 记录广告展示
   */
  _recordAdShown(adType) {
    const now = Date.now();
    this._lastAdTime = now;

    if (adType === AD_TYPES.REWARDED) {
      this._adCountToday.rewarded++;
    } else if (adType === AD_TYPES.INTERSTITIAL) {
      this._adCountToday.interstitial++;
    }

    this._saveAdCounts();
  }

  /**
   * 加载广告计数
   */
  _loadAdCounts() {
    try {
      const stored = localStorage.getItem('openblock_ad_counts_v1');
      if (stored) {
        const data = JSON.parse(stored);
        this._adCountToday = data.counts || { rewarded: 0, interstitial: 0 };
      }
    } catch {}
  }

  /**
   * 保存广告计数
   */
  _saveAdCounts() {
    try {
      localStorage.setItem('openblock_ad_counts_v1', JSON.stringify({
        counts: this._adCountToday,
        date: new Date().toISOString().slice(0, 10)
      }));
    } catch {}
  }

  /**
   * 新一天重置计数
   */
  _resetDailyIfNeeded() {
    try {
      const stored = localStorage.getItem('openblock_ad_counts_v1');
      if (stored) {
        const data = JSON.parse(stored);
        const today = new Date().toISOString().slice(0, 10);
        if (data.date !== today) {
          this._adCountToday = { rewarded: 0, interstitial: 0 };
          this._saveAdCounts();
        }
      }
    } catch {}
  }

  /**
   * 启动频率保护定时器
   */
  _startFrequencyGuard() {
    // 每分钟检查一次
    setInterval(() => {
      this._resetDailyIfNeeded();
      // 强制更新商业模型
      this.getCommercialVector(true);
    }, 60000);
  }

  /**
   * 激励广告完成回调
   *
   * v1.13 修复：
   *   - 旧实现写 `wallet.addBalance('stamina', …)`，但 'stamina' 不在 wallet KINDS 白名单
   *     （hintToken/undoToken/bombToken/rainbowToken/freezeToken/previewToken/rerollToken/
   *      coin/trialPass/fragment），addBalance 会直接 return false，等于死代码；
   *   - 现在按 `reward.type` 路由到合法 kind：默认（含 stamina 旧值）兑换为 coin，
   *     `hint`/`undo`/`bomb` 等显式直接进对应 token；source 统一 'ad_reward' 便于聚类。
   *   - 注：onRewardedAdCompleted 当前在仓库内仍无业务方调用（adTrigger 只 emit 总线事件）；
   *     此修复让它在被调用时**至少能正确入账**，便于未来接入 SDK 回调或 e2e 测试触发。
   */
  onRewardedAdCompleted(reward) {
    console.log('[AdEngine] Rewarded ad completed:', reward);
    const wallet = window.__wallet;
    if (!wallet || !reward) return;
    const amount = Math.max(1, Number(reward.amount) || 1);
    const KIND_MAP = {
      hint: 'hintToken', hintToken: 'hintToken',
      undo: 'undoToken', undoToken: 'undoToken',
      bomb: 'bombToken', bombToken: 'bombToken',
      rainbow: 'rainbowToken', rainbowToken: 'rainbowToken',
      coin: 'coin', fragment: 'fragment',
      // stamina 暂无对应通货，统一兑换为 coin 兜底（与旧 'stamina' 行为兼容）
      stamina: 'coin',
    };
    const kind = KIND_MAP[reward.type] || 'coin';
    try {
      wallet.addBalance(kind, amount, 'ad_reward');
    } catch (e) {
      console.warn('[AdEngine] reward grant failed', e);
    }
  }

  /**
   * 获取当前广告状态（UI 显示用）
   */
  getAdStatus() {
    const vector = this.getCommercialVector();
    const config = getStrategyConfig().commercialModel ?? {};
    const fatigueCfg = config.adFatigue ?? {};

    return {
      canShowRewarded: shouldAllowMonetizationAction(vector, 'rewarded'),
      canShowInterstitial: shouldAllowMonetizationAction(vector, 'interstitial'),
      rewardedRemaining: (fatigueCfg.rewardedMax ?? 12) - this._adCountToday.rewarded,
      interstitialRemaining: (fatigueCfg.interstitialMax ?? 6) - this._adCountToday.interstitial,
      recommendedAction: vector.recommendedAction,
      explain: vector.explain,
      fatigue: vector.adFatigueRisk
    };
  }
}

let _instance = null;
export function getAdDecisionEngine() {
  if (!_instance) {
    _instance = new AdDecisionEngine();
  }
  return _instance;
}

export { AD_TYPES, AD_SCENES };