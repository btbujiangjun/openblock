/**
 * 商业化策略子系统统一出口
 *
 * 分层架构：
 *   L1  strategyConfig.js   — 集中配置（所有可定制数据）
 *   L2  strategyEngine.js   — 决策引擎（纯函数评估）
 *   L3  strategyHelp.js     — cursor:help 文案中心
 *
 * 业务模块（personalization / adTrigger / iapAdapter / commercialInsight / monPanel）
 * 仅 import 这一个文件即可拿到全部 API；底层文件的拆分对调用方透明。
 */

export {
    DEFAULT_STRATEGY_CONFIG,
    getStrategyConfig,
    setStrategyConfig,
    resetStrategyConfig,
    registerStrategyRule,
    unregisterStrategyRule,
    getSegmentDef,
    classifySegment,
} from './strategyConfig.js';

export {
    evaluate,
    buildWhyLines,
    shouldTriggerRule,
} from './strategyEngine.js';

export {
    HELP_TEXTS,
    getHelpText,
    helpAttrs,
    markHelp,
    registerHelp,
    listHelpKeys,
    dumpConfigSchema,
} from './strategyHelp.js';
