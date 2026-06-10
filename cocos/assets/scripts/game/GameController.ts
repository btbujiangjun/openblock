import { _decorator, Component, Node, Graphics, UITransform, Vec3, Color, Label, input, Input, EventTouch, view, sys, UIOpacity, Tween, tween } from 'cc';
import {
    GameModel, GameEvent, ShapeMatrix, MetaState, grantCheckinReward, findHint, listBestPlacements, SKILLS, SkillId,
    Progression, AchievementState, SeasonPass, SeasonTask, SeasonTaskType, SeasonChestState, DailyState, dateKey, listSkinIds, getSkin, t,
    WalletKind,
    getConfig, flag, Analytics, ANALYTICS_EVENTS, spinWheel, WHEEL_PRIZES, WHEEL_TRIAL_POOL, WheelPrize, GameMode, MODE_ORDER, getMode,
    PlayerContext, CompanionState, getCompanion, ReplayRecorder, Grid, AdaptiveProfile, shouldShowNearMiss,
    primaryIntent, toneFor, intentNarrative, taskDensityBonus, type Tone, type Band,
    bonusEffectHoldMs,
} from '../core';
import { BoardView } from './BoardView';
import { DockView } from './DockView';
import { Hud } from './Hud';
import { LineClearFx } from './effects/LineClearFx';
import { FxLayer } from './effects/FxLayer';
import { AmbientFx } from './effects/AmbientFx';
import { OverlayFx } from './effects/OverlayFx';
import { ScreenShake } from './effects/ScreenShake';
import { SkillBar } from './skills/SkillBar';
import { MetaPanel } from './ui/MetaPanel';
import { ModalPanel, ModalButton } from './ui/ModalPanel';
import { GameOverPanel, GameOverFact, GameOverLink } from './ui/GameOverPanel';
import { WheelPanel } from './ui/WheelPanel';
import { SkinPanel } from './ui/SkinPanel';
import { LorePanel } from './ui/LorePanel';
import { ReplayPanel } from './ui/ReplayPanel';
import { CheckInPanel } from './ui/CheckInPanel';
import { SeasonPassPanel } from './ui/SeasonPassPanel';
import { LeaderboardPanel } from './ui/LeaderboardPanel';
import { Toast } from './ui/Toast';
import { DailyMaster } from './social/DailyMaster';
import { ChurnPredictor, type LifecycleStage } from './social/ChurnPredictor';
import { ReplayStore } from './platform/ReplayStore';
import { CompanionView } from './companion/CompanionView';
import { playSkinTransition } from './effects/SkinTransition';
import { Modal, TapBus, screenToLocal, inheritLayer } from './ui/uiKit';
import { guard, reportFatal } from './ui/Fatal';
import { blockColor, bgColor, accentColor, blockIcon, blockMetrics } from './skin/palette';
import { drawShapeFaces, iconFontSize, ICON_FONT_FAMILY } from './skin/blockPaint';
import { seasonalAccent } from './skin/seasonalSkin';
import { consumeFestivalRecommendation, consumeWeekendTrial, consumeBirthdayGift } from './skin/seasonalRecommend';
import { Storage, STORAGE_KEYS } from './platform/Storage';
import { AudioManager } from './audio/AudioManager';
import { Haptics } from './platform/Haptics';
import { VisualFx } from './platform/VisualFx';
import { FrameRate } from './platform/FrameRate';
import { Ads } from './platform/Ads';
import { Share } from './platform/Share';
import { Leaderboard } from './platform/Leaderboard';
import { CloudSync } from './platform/CloudSync';

/* v1.69 evaluation host：ESM 闭包来自 engine/evaluation/*.mjs（sync-cocos-engine.mjs 自动生成）。
 * 端无关 host 契约见 web/src/evaluation/evaluationHost.js JSDoc。
 *
 * Cocos 端 **Phase 1** 仅启用 spawn / gameOver 两层 evaluation：
 *   - per-place 评估（placementQuality）需要"放置前盘面快照"，会要求重构 GameModel
 *     的 place 事件发出顺序（boardBefore → place → boardAfter），暂未做。
 *   - session-level / RoR 报告仍可输出，只是 components.usagePerm 等会缺。
 * 详见 docs/algorithms/SESSION_EVALUATION.md §"端侧覆盖阶段表"。 */
// @ts-ignore: .mjs 在 Cocos 构建时按 ESM 解析
import { evalOnSessionStart, evalOnSpawn, evalOnGameOver } from '../engine/evaluation/evaluationHost.mjs';
// @ts-ignore: .mjs 数据导出
import GAME_RULES_DATA from '../engine/gameRulesData.mjs';

const { ccclass } = _decorator;

/**
 * 触屏拖拽 lift 参数 —— ⚠️ 已与 web CONFIG 解耦（web 鼠标 + 触屏混用所以 lift 较大；
 * cocos 端原生纯触屏，沿用 web 值会把 4×1 直立块抬出半屏，玩家投诉「拖动慢/不跟手」
 * 的真实根因是「视线被迫在手指和远处的块之间跳」）。
 *
 * ⭐ v3 公式（clearance-based，对齐 Block Blast / Wood Block 体感）：
 *   lift = blockHalf + GAP_CELLS · cell        —— 让 block 底边相对手指始终有固定 GAP 间隙
 *   优势：
 *     - 小块（1×1）：lift 自然小（~0.8 cell），紧贴手指，"指哪到哪"。
 *     - 大块（5×1 vert）：lift 自然大（~2.8 cell），但 block 底边距手指仍然是 GAP —— 玩家始终
 *       能"看到"落点位置，不需要"在脑子里偏移"，告别"看不见块底"的视觉断层。
 *     - 旧版用 MAX_CELLS cap 上限，大块底边沉到手指下方，玩家觉得"看不见落点 + 拖得慢"。
 *
 * 各形状 lift 估算（cell=70px, GAP=0.3）：
 *                              v1 (web 对齐)   v2 (MAX cap)    v3 (clearance)
 *   1×1                        158px           101px           56px
 *   2×2                        193px           137px           91px
 *   1×4 vert                   263px           154px           161px
 *   1×5 vert                   298px           154px ⚠️        196px
 *                              （v2 大块底边在手指下方，无法精准对齐）
 */
const DRAG_TOUCH_LIFT_GAP_CELLS = 0.3;
/** 触屏拖拽跟手倍率：明显放大手指位移，减少从候选区拖到盘面的行程；鼠标/桌面仍保持 1:1。 */
const DRAG_TOUCH_TRACK_GAIN = 2.0;
/** 手指移动超过该像素才视为「开始拖拽」（此前 ghost 停在候选区原位）。 */
const DRAG_MOVE_THRESHOLD = 4;

/** lift 时间渐进窗口（毫秒）：dragMoved 翻 true 后，lift 在 LIFT_RAMP_MS 内由 0 升到满 lift。
 *  曲线为 easeOutCubic（见 moveGhost / advanceLiftRamp）——前 30% 时间完成 ~66% 的抬升。
 *  ⭐ v3 lift 普遍只有 50~200px，ramp 30ms ≈ 2 帧（60Hz）/ 4 帧（120Hz），视觉上接近瞬时，
 *     但仍保留了「pop-out 触发感」（完全 0ms 会让小块感觉块凭空"跳"出来）。
 *  ⭐ 时间驱动而非距离驱动：水平方向按触屏倍率跟手；垂直 lift 由 update() 独立推进，即使手指停住也会继续渐进。 */
const LIFT_RAMP_MS = 30;

/** ghost 激活弹出动效时长（秒）：scale 从 0.6 弹回 1.0 的 backOut 时长。
 *  从 0.13s → 0.07s → 0.05s，对齐主流休闲游戏「按下即生效，无明显 settling」的感受。 */
const POP_GHOST_DURATION_S = 0.05;

/** 触摸诊断开关：排查「按钮点不动」时设 true，在 Xcode/控制台看每次触摸的坐标与命中结果。
 *  确认无误后改回 false 关闭日志。 */
const DEBUG_TOUCH = false;

/** 拖拽心跳超时（毫秒）：进行中拖拽（手指应仍按住）超过此时长无 TOUCH_MOVE / TOUCH_END，
 *  update() 看门狗会强制 cancelDrag。常见触发：iOS WKWebView 系统手势接管 / 控制中心下拉吞掉 END /
 *  安卓沉浸式 surfaceChanged / 边缘手势让出触摸 … 这是「候选块再也激活不了」最常见的隐藏成因，
 *  也是「触摸事件风暴」的源头前兆 —— END/CANCEL 被平台吞掉而 dragIndex 永久残留。 */
const DRAG_STALE_TIMEOUT_MS = 3500;

/** 悬浮选中（tap-select）僵尸上限（毫秒）：点选候选块后 ghost 悬停、手指已抬起，等待下一次点击落子，
 *  这是合法的长驻态（玩家在思考落点，对齐 Block Blast 类「点选不需一直按住」的范式）。此态下没有任何
 *  TOUCH_MOVE 刷新心跳，故绝不能按 DRAG_STALE_TIMEOUT_MS 误清；仅用这个很大的上限兜底极端僵尸态，
 *  防止 dragIndex 永久占用而后续无法激活其它候选块。 */
const DRAG_HOVER_STALE_MS = 30000;

/** Modal 假性打开自愈窗（毫秒）：onTouchStart 拦截在 Modal.isOpen 上累计达到此时长，
 *  且场景内确实没有 modal 节点 → 视为计数泄漏，强制 Modal.reset 让交互恢复。 */
const MODAL_GHOST_HEAL_MS = 5000;

/** gameOver 无面板自愈窗（毫秒）：model.gameOver 为真但场景内既无结算卡也无复活弹窗
 *  （Modal 计数为 0）持续达到此时长 → 说明结算/复活面板没能弹出（build 抛错 / 事件链中断），
 *  此时 onTouchStart 会被 gameOver 守卫永久拦死且无 UI 可退出，表现为「玩到中途候选块全部
 *  无法激活、又看不到任何弹窗」。看门狗据此重新弹出结算卡，保证玩家始终能「再来一局」。 */
const GAMEOVER_NO_PANEL_HEAL_MS = 1500;

/** 泄漏守卫兜底：用户连续点击「死区」（未命中任何可交互目标）却被 Modal/metaPanel 守卫拦住、
 *  且场景内确无合法弹窗 —— 判定为僵尸守卫态（Modal 计数泄漏 / metaPanel.active 卡死，
 *  常见于 iOS 边缘手势吞事件、弹窗 close 竞态）。达到下列次数/时窗即主动恢复交互。
 *  gameOver 不在此列：它由 gameOverHealTick 重新弹结算卡处理，不能在这里放行落子。 */
const DEAD_TAP_RECOVER_COUNT = 2;
const DEAD_TAP_WINDOW_MS = 3000;

/** 局末宝箱分级（对齐 web endGameChest：普通/稀有/史诗）。 */
type ChestTier = 'common' | 'rare' | 'epic';

/** 宝箱奖励（token 道具礼包；_trial=true 时附带随机限时试穿券）。 */
type ChestReward = Partial<Record<WalletKind, number>> & { _trial?: boolean };

/**
 * 局末宝箱各级奖励池（严格对齐 web `endGameChest.js` TIER_REWARDS）：命中后从对应池随机取一份。
 */
const CHEST_TIER_REWARDS: Record<ChestTier, ChestReward[]> = {
    common: [{ hintToken: 1 }, { undoToken: 1 }],
    rare: [{ hintToken: 2 }, { bombToken: 1 }, { rainbowToken: 1 }],
    epic: [{ hintToken: 5, bombToken: 1, rainbowToken: 1, _trial: true }],
};

/** 史诗箱试穿券皮肤池（对齐 web TRIAL_SKIN_POOL；运行时按已存在皮肤过滤）。 */
const CHEST_TRIAL_SKIN_POOL = ['forbidden', 'demon', 'fairy', 'aurora', 'industrial', 'mahjong'];

/**
 * 落子智能吸附参数 —— 与 web/src/config.js 对齐：
 *   placeRadius        ← web CONFIG.PLACE_SNAP_RADIUS
 *   clearLineBonus     ← web CONFIG.HOVER_CLEAR_LINE_BONUS
 *   clearCellBonus     ← web CONFIG.HOVER_CLEAR_CELL_BONUS
 *   clearAssistWindow  ← web CONFIG.HOVER_CLEAR_ASSIST_WINDOW
 *   stickyBonus        ← web CONFIG.HOVER_STICKY_BONUS  （拖拽时再 ×0.35 降权，避免过粘）
 *   stickyWindow       ← web CONFIG.HOVER_STICKY_WINDOW （拖拽时再 ×0.55 降权）
 *
 * 释放路径：走 `pickSmartHoverPlacement(radius=placeReleaseRadius)`，严格 anchor 命中（d=0）由
 *    距离权重天然胜出；失败时在 placeReleaseRadius 内择优救活（消行点优先，其次最近）。
 *    - placeReleaseRadius = 2（与 web/miniprogram `PLACE_RELEASE_SNAP_RADIUS` 同名同值）。
 *    - 释放路径不带 sticky，避免「拖偏后松手仍粘在上一帧 hover 预览」造成不可预期落点。
 *    - 兜底场景：浮点取整在格边界 ±0.01 抖动 / 用户视觉对准但手指略偏邻格中心。
 */
const SNAP = {
    placeRadius: 2,
    /** 释放容错半径（曼哈顿格）：拖拽松手时若严格 anchor 不合法，在该半径内择优救活。
     *  与 web `CONFIG.PLACE_RELEASE_SNAP_RADIUS` / miniprogram `PLACE_RELEASE_SNAP_RADIUS` 同名对齐。
     *  1 → 2：轻微增加容差，进一步减少「明明拖到了目标格却释放失败」的边界抖动 miss；
     *  仍走 4 邻域曼哈顿（非对角），保留可预期性，不会"窜两格"。 */
    placeReleaseRadius: 2,
    clearLineBonus: 0.9,
    clearCellBonus: 0.015,
    clearAssistWindow: 1.35,
    stickyBonus: 0.32,
    stickyWindow: 0.75,
    /** 落地虚影 alpha：拖拽时在真实吸附落点画候选块（比指尖跟手块更淡，读作「会落在这里」的影子）。 */
    landingGhostAlpha: 96,
} as const;

/** 核心循环编排：连接 GameModel 与所有视图/特效/技能/元系统/存档。 */
@ccclass('GameController')
export class GameController extends Component {
    model!: GameModel;
    meta!: MetaState;
    board!: BoardView;
    ambientFx!: AmbientFx;
    lineFx!: LineClearFx;
    fx!: FxLayer;
    overlayFx!: OverlayFx;
    dock!: DockView;
    hud!: Hud;
    ghost!: Node;
    skillBar!: SkillBar;
    metaPanel!: MetaPanel;
    shakeTarget!: Node;
    bgNode!: Node;
    /** 玩家画像 / 出块上下文（喂给真实引擎；本控制器在消行/计分事件里更新）。 */
    playerCtx!: PlayerContext;
    /** 真实 PlayerProfile（喂给 resolveAdaptiveStrategy 使寻参 θ 生效；本控制器在落子/消行处驱动）。 */
    profile?: AdaptiveProfile;
    /** 出块器引用：新局开始时 resetForNewGame() 清掉跨局 _prevScoreMilestone / specialShapeUsed 等。 */
    spawner?: { resetForNewGame: () => void };
    /** 本次落子后的盘面填充率快照（在 'place' 记录，微任务里连同消行结果喂 profile.recordPlace）。 */
    private _pendingPlaceFill = -1;
    /** 本次落子是否触发消行 + 行数（'clear' reason='line' 时更新，微任务 flush 后归零）。 */
    private _pendingClearLines = 0;

    // 玩家档案子系统（核心层，控制器负责加载/保存）
    progression = new Progression();
    achievements = new AchievementState();
    seasonPass = new SeasonPass();
    seasonChest = new SeasonChestState();
    daily = new DailyState();
    companion = new CompanionState();
    private companionView: CompanionView | null = null;
    private replay = new ReplayRecorder();

    // 累计统计（成就判定用）
    private stats = { totalGames: 0, totalLines: 0, maxComboLines: 0, perfectClears: 0 };

    private dragIndex = -1;
    private dragShape: ShapeMatrix | null = null;
    private dragColor = 0;
    private snap: { gx: number; gy: number } | null = null;
    /** 起手屏幕坐标（web drag.startX/Y）。 */
    private dragStartScreenX = 0;
    private dragStartScreenY = 0;
    /** ghost 激活时锚在候选槽中心的父节点局部坐标。 */
    private dragOriginX = 0;
    private dragOriginY = 0;
    /** 是否已越过移动阈值（原地激活 vs 跟手拖拽）。 */
    private dragMoved = false;
    /** 当前拖拽锁定的 touchId（防止多指误触结束/移动到主拖拽手指）。 */
    private dragTouchId: number | null = null;
    /** 当前拖拽起手时间戳（ms），用于 stale 自愈判定：超过阈值未结束的 drag 一律视为僵尸态。 */
    private dragStartedAtMs = 0;
    /** 首次因 Modal.isOpen 被拦截的时间戳，用于「假性 modal」自愈窗判定。 */
    private _modalBlockSinceMs = 0;
    /** 任何 TOUCH_MOVE/END 时刷新；用于"长时间无心跳"的 stale 判定。 */
    private dragLastSeenAtMs = 0;
    private _ghostIconRoot: Node | null = null;
    private _ghostIcons: Label[] = [];
    /**
     * tap-to-select：上一次触摸是「点按候选块后未拖动直接松手」→ ghost 保持悬浮，等待下一次触摸完成
     * 「点板面落子」或「点别的候选块切换/点同槽位取消选中」。这是大多数休闲方块拼图（Block Blast 等）
     * 默认的交互范式，对触屏远比 hold-and-drag 友好（不需要"始终按住"）。
     * 同时仍兼容 hold-and-drag：第一次触摸只要发生过 TOUCH_MOVE（dragMoved=true），松手即按拖拽语义结算。
     */
    private _tapSelected = false;
    /**
     * tap-select 第二次触摸的"待定动作"（deferred tap-or-drag）：
     *   - 'place'    手指落在板面 → 不动松手 ⇒ 尝试落子；任何位移 ⇒ 升级为 drag
     *   - 'deselect' 手指落在同一候选槽 → 不动松手 ⇒ 取消选中；任何位移 ⇒ 升级为 drag
     *   - null       未在待定中（普通拖拽 / 未激活 / 已升级为 drag）
     * 这是修复「选中后无法左右拖动候选块」的核心：旧逻辑在 onTouchStart 立即执行 PLACE/DESELECT，
     * onTouchMove 永远没机会跑；现在把动作延迟到 onTouchEnd，给手指留出"按下后再决定拖或点"的窗口。
     */
    private _pendingTapAction: 'place' | 'deselect' | null = null;
    /**
     * lift 时间驱动状态（与 LIFT_RAMP_MS 配合）：
     *   _liftFactor       当前 lift 进度（0~1），ghost.y 的额外抬升 = dragLiftPx() · _liftFactor
     *   _dragMovedAtMs    dragMoved 翻 true 的时间戳，update() 据此推进 _liftFactor
     *   _lastTouchScreenX/Y  最近一次 touch-move 的屏幕坐标，update() 用它在手指不动时重新摆放 ghost
     * 这是修复「拖动轨迹斜挑感」的核心：水平 horizontal motion 与垂直 lift 解耦。
     */
    private _liftFactor = 0;
    private _dragMovedAtMs = 0;
    private _lastTouchScreenX = 0;
    private _lastTouchScreenY = 0;
    /** 触摸事件重复派发去重：iOS 边缘手势 / 系统手势冲突时引擎会以 50Hz+ 重复发同一 touch-end → UI 假死。 */
    private _lastTouchEndTouchId = -2;
    private _lastTouchEndX = -1;
    private _lastTouchEndY = -1;
    private _lastTouchEndAtMs = 0;
    private _dupTouchEndCount = 0;
    /** 坐标无关的 touch-end 速率守卫：引擎卡死时会在多个坐标间交替高频重发，同坐标去重抓不到，
     *  改用"滚动 1s 窗内总次数"判定风暴 → 超阈值直接丢弃 + 自愈，根治 UI 假死（见 onTouchEnd）。 */
    private _touchEndWindowStartMs = 0;
    private _touchEndWindowCount = 0;
    private pendingSkill: SkillId | null = null;
    private aimAssist = false;
    private timeLeft = 0;
    private settled = false;
    /** 是否正处于「启动每日大师题」的开局调用中（用于让 startGameImpl 不清掉刚建立的日固定种子）。 */
    private _dailyMasterStarting = false;
    /** 结算卡展示参数缓存（settle 时算好）：用于「gameOver 无面板」自愈时安全重弹结算卡，
     *  不重跑 settle 的经济副作用（经验/宝箱等已由 settled 守卫）。 */
    private _settleDisplay: { xpGain: number; leveledUp: boolean; level: number } | null = null;
    /** gameOver 无面板自愈计时起点（0=未计时）。 */
    private _gameOverHealAtMs = 0;
    /** 复活激励视频等待中：看广告按钮点下后弹窗已 close（Modal 计数归 0），但广告是异步回调，
     *  期间 gameOver=true && Modal 计数=0 —— 必须让 gameOver 自愈避让，否则会在看广告时误弹结算卡。 */
    private _reviveAdPending = false;
    /** 连续「死区被拦」点击计数与时窗起点（泄漏守卫兜底，见 DEAD_TAP_RECOVER_COUNT）。 */
    private _deadBlockedTaps = 0;
    private _firstDeadBlockedTapMs = 0;
    /** 本局开始时的历史最佳，用于结算判断是否破纪录。 */
    private prevBest = 0;
    /** 本局命中的局末宝箱（对齐 web：结算卡关闭后再弹），未命中为 null。 */
    private _pendingChest: { tier: ChestTier; reward: ChestReward } | null = null;
    /** 连续消行 streak（对齐 web `_clearStreak`）：每次落子若消行则 +1，否则归零。≥3 触发 streak 徽章。 */
    private _clearStreak = 0;
    /**
     * 本局战报统计（对齐 web `gameStats`）—— 仅当局可观测量，新开局/重开时重置。
     * clears=本局总消行数；maxCombo=本局单手最大消行数；placements=成功落子数；
     * misses=非法释放次数（命中率 = placements/(placements+misses)）；startMs=本局开始时刻。
     */
    private game = { clears: 0, maxCombo: 0, placements: 0, misses: 0, startMs: 0, pbBaseline: 0 };
    /** 本局是否已庆祝过破纪录（对齐 web `_maybeCelebrateNewBest` 每局最多一次完整庆祝）。 */
    private _celebratedNewBest = false;
    /**
     * 「差一行」近失鼓励的控频状态（严格对齐 web `nearMissPlaceFeedback`）：
     * 单局最多展示次数、上次展示的落子序号 / 时间戳，配合 `shouldShowNearMiss` 决策。
     */
    private _nearMissToastCount = 0;
    private _nearMissLastPlacement: number | null = null;
    private _nearMissLastShownMs: number | null = null;
    /** 由 Bootstrap 注入：从结束卡「菜单」返回主菜单。 */
    onRequestMenu: (() => void) | null = null;
    /**
     * Ghost 生命代际 token：每次新拖拽 +1。reject 抖动的延迟清理回调会拿激活时的 token 与现值对比，
     * 若不一致说明用户已开启新一次拖拽 → 跳过清理，避免清掉新 ghost 的渲染状态（"无法二次激活"根因）。
     */
    private _ghostGen = 0;
    /** 最近一次落子的盘面中心格（用于 score 飘字定位到玩家视线焦点附近）。 */
    private _lastPlaceCenter: { gx: number; gy: number } | null = null;
    /** 最近一次消行的 kind（normal/combo/perfect），影响 score 飘字字号与颜色。下次 score 事件消费后清零。 */
    private _nextScoreKind: 'normal' | 'multi' | 'combo' | 'perfect' | 'new-best' | 'bonus' = 'normal';
    /** 最近一次消行的飘字标签（双消/N消/清屏，对齐 web float-score 分级文案）。下次 score 事件消费后清空。 */
    private _nextScoreLabel: string | null = null;

    wire(parts: {
        model: GameModel;
        meta: MetaState;
        board: BoardView;
        ambientFx: AmbientFx;
        lineFx: LineClearFx;
        fx: FxLayer;
        overlayFx: OverlayFx;
        dock: DockView;
        hud: Hud;
        ghost: Node;
        skillBar: SkillBar;
        metaPanel: MetaPanel;
        shakeTarget: Node;
        bgNode: Node;
        playerCtx: PlayerContext;
        profile?: AdaptiveProfile;
        /** 出块器引用：新局开始时调 resetForNewGame() 清掉跨局态。可选（缺省时回退为 no-op，老路径仍兼容）。 */
        spawner?: { resetForNewGame: () => void };
    }): void {
        Object.assign(this, parts);
    }

    start(): void {
        guard('GameController.start', () => this.startImpl());
    }

    private startImpl(): void {
        console.log('[OpenBlock] GameController.start begin');
        this.board.setSkin(this.model.skin);
        this.model.onEvent((e) => this.onModelEvent(e));

        this.skillBar.setup((id) => this.onSkill(id), this.model.wallet);
        this.metaPanel.setup(this.meta, this.model.wallet, () => this.save());
        this.metaPanel.setExtra(this.progression, this.daily, this.seasonPass, this.achievements);
        // 下钻入口：签到行 → 7 日签到日历；赛季行 → 赛季通行证轨道（对齐 web 独立弹窗）。
        this.metaPanel.setDrilldowns(() => this.openCheckin(), () => this.openSeasonPass());

        // 加载玩家档案子系统
        this.progression.fromJSON(Storage.getJSON(STORAGE_KEYS.progression, null));
        this.achievements.fromJSON(Storage.getJSON(STORAGE_KEYS.achievements, null));
        this.seasonPass.fromJSON(Storage.getJSON(STORAGE_KEYS.season, null));
        this.seasonChest.fromJSON(Storage.getJSON(STORAGE_KEYS.seasonChest, null));
        this.daily.fromJSON(Storage.getJSON(STORAGE_KEYS.daily, null));
        this.stats = Storage.getJSON(STORAGE_KEYS.stats, this.stats);
        this.companion.fromJSON(Storage.getJSON(STORAGE_KEYS.companion, null));
        this.setupCompanion();

        const soundOn = Storage.get(STORAGE_KEYS.sound, '1') !== '0';
        AudioManager.setEnabled(soundOn);
        // 与 web `_primeOutput` 对齐：尽早 arm 用户手势监听器解锁 WebAudio Context，
        // 避免 iOS WKWebView / Safari / 桌面浏览器加载后 ctx=suspended 导致所有 SFX 哑火。
        AudioManager.armUnlock();
        // 震动开关持久化（默认开）：用户上次选择跨会话生效。
        Haptics.enabled = Storage.get(STORAGE_KEYS.haptics, '1') !== '0';
        Analytics.track(ANALYTICS_EVENTS.sessionStart, { mode: this.model.mode });
        if (flag('bgm') && soundOn) AudioManager.startBgm();
        // 季节环境氛围（按当月强调色缓慢飘落柔光，营造节令感）。
        this.fx.startAmbience(seasonalAccent());
        // 皮肤主题环境粒子（樱花/落叶/气泡/萤火虫/流星/极光/涟漪），对齐 web ambientParticles。
        this.ambientFx.applySkin(this.model.skin.id);
        Share.registerShareMenu(() => this.model.best);

        const saved = Storage.getJSON<Record<string, unknown> | null>(STORAGE_KEYS.save, null);
        if (saved && this.model.fromJSON(saved as never) && !this.model.gameOver) {
            this.board.setSkin(this.model.skin);
            this.ambientFx.applySkin(this.model.skin.id);
            // 存档常停在「刚落下最后一块、尚未补充候选」的瞬间，恢复后候选区会是空的，
            // 此时补一批候选，避免「无候选出块」无法继续。
            this.model.ensurePlayableDock();
            // 续局：从恢复点开始录制回放。第一帧记为当前盘面 snapshot，
            // 让结算后回看时直接对齐"续局起点"，避免只能看到续局后半截的空盘面 → 突然全满的跳变。
            this.replay.begin(this.model.grid.size, this.model.mode, this.model.skin.id, this.model.best);
            this.replay.recordSnapshot(this.model.grid.cells);
            // prevBest 必须在 fromJSON 之后抓拍：fromJSON 会 Math.max(this.best, data.best)，
            // 在此之前 model.best 还是 Storage 的裸值，可能与"本次续局开始时"的真 best 不一致 → 结算 newBest 判定错。
            this.prevBest = this.model.best;
            // 续局：本局战报从恢复点开始计（旧统计无法重建），用时按恢复时刻起算。
            this.game = { clears: 0, maxCombo: 0, placements: 0, misses: 0, startMs: Date.now(), pbBaseline: this.model.best };
            this._celebratedNewBest = false;
            this.resetNearMiss();
            this.resetInPlayHud();
            this.renderAll();
        } else {
            // 走新开局路径：startGame 内部会重置 score、newGame 并把 prevBest 抓拍。
            this.startGame(this.model.mode);
        }

        // 赛季宝箱离线补发（对齐 web init catch-up）：必须在模型（含钱包）加载/开局之后再结算，
        // 否则会把奖励发到「即将被存档覆盖」的临时钱包上 → 丢奖。续局路径静默补发（不打断棋局），
        // 新开局路径已由 startGameImpl 内 grantSeasonChests(true) 处理，这里二次调用为幂等空操作。
        this.grantSeasonChests(false);

        this.hud.setBest(this.model.best);
        this.hud.setCoins(this.model.wallet.coins);
        this.hud.setLevel(this.progression.level);
        this.refreshHudSkin();
        this.skillBar.refresh();
        // 落地 lifecyclePlaybook 的「任务密度」侧：按 阶段×成熟度 给今日 dish 注入密度加成（早于任何消行进度写入，保证当日稳定）。
        this.daily.getDish(dateKey(), taskDensityBonus(this.deriveLifecycleStage(), this.deriveMaturityBand()));
        this.renderAll();
        console.log('[OpenBlock] GameController.start done (renderAll ok)');
        // 回归礼包等模态入场流程仍由主菜单「开始/继续」后触发（见 enterFromMenu），
        // 避免在菜单之下先弹浮层（与 web「先菜单后入场」一致）。
        // 但「非模态」启动提示（转盘可用等，对齐 web luckyWheel ~2.2s toast）改为直达对局后
        // 用 Toast 浮条呈现 —— 既给到入场信息又不引入会卡死的模态。
        // 入场福利链（首日礼包/回流/签到提醒/FTUE）：~1.5s 先入队（对齐 web 首日 1.5s），转盘 ~2.2s 随后排队。
        this.scheduleOnce(() => this.maybeShowEntryToasts(), 1.5);
        this.scheduleOnce(() => this.maybeShowStartupToasts(), 2.2);
    }

    /**
     * 冷启动入场福利链（D 的「非模态」实现，对齐 web popupCoordinator 入场弹窗的意图，但保持「直达对局、不弹模态」）：
     *  - 首启动：自动入账首日礼包金币 + celebrate toast 告知；并附 FTUE 拖拽/消行 bar 提示（对齐 web FTUE）。
     *  - 回流：按离线天数自动入账回归金币 + celebrate toast 告知（对齐 web welcomeBack）。
     *  - 老用户当日未签：签到提醒 bar toast（带「签到」按钮 → 打开签到面板）。
     *
     * 复用 web 同款存储键（firstLaunch / lastSeen），与菜单路径 `maybeWelcomeBack` 互斥去重：
     * 本方法已把 lastSeen 推进到 now、首启已写 firstLaunch，故玩家随后经菜单返回时 maybeWelcomeBack 不会重复发放。
     */
    private maybeShowEntryToasts(): void {
        if (!this.node?.isValid) return;
        const now = Date.now();
        const first = Storage.get(STORAGE_KEYS.firstLaunch, null);
        const last = Storage.getNumber(STORAGE_KEYS.lastSeen, 0);
        Storage.setNumber(STORAGE_KEYS.lastSeen, now);
        if (!first) {
            Storage.set(STORAGE_KEYS.firstLaunch, String(now));
            const gift = 50;
            this.model.wallet.earn(gift);
            this.hud.setCoins(this.model.wallet.coins);
            this.save();
            Toast.show({ text: t('toast.firstDayPack', { n: gift }), tier: 'celebrate', durationMs: 4000 });
            Toast.show({ text: t('toast.ftueDrag'), tier: 'bar', durationMs: 5000 });
            Toast.show({ text: t('toast.ftueClear'), tier: 'bar', durationMs: 5000 });
            return;
        }
        if (last > 0) {
            const days = Math.floor((now - last) / 86400000);
            if (days >= 1) {
                const gift = Math.min(200, 30 * days);
                this.model.wallet.earn(gift);
                this.hud.setCoins(this.model.wallet.coins);
                this.save();
                Toast.show({ text: t('toast.welcomeBack', { days, gift }), tier: 'celebrate', durationMs: 4000 });
                return;
            }
        }
        // 老用户、当日未签到：给一个带「签到」按钮的提醒（对齐 web checkIn 入场提示，但非模态）。
        if (this.meta.canCheckin()) {
            Toast.show({
                text: t('toast.checkinReminder'),
                tier: 'bar',
                durationMs: 5000,
                actionLabel: t('daily.checkin'),
                onAction: () => this.openCheckin(),
            });
        }
    }

    /**
     * 启动期非模态提示（对齐 web 启动后延时 toast；保持 cocos「直达对局」不弹模态）：
     * 目前接入「今日免费转盘可领取」（周一/周五，对齐 web luckyWheel.js ~2.2s，时长 7s，带「去抽」按钮）。
     * 季节/周末/生日推荐 toast 依赖季节推荐引擎，待该模块移植后在此追加。
     */
    private maybeShowStartupToasts(): void {
        if (!this.node?.isValid) return;
        if (flag('wheel') && WheelPanel.canSpinToday()) {
            Toast.show({
                text: t('toast.wheelReady'),
                tier: 'bar',
                durationMs: 7000,
                actionLabel: t('toast.wheelAction'),
                onAction: () => this.openWheel(),
            });
        }
        this.maybeShowSeasonalToasts();
        this.maybeShowChurnIntervention();
        this.maybeShowStrategyHint();
    }

    /** 由累计局数推导生命周期阶段（粗粒度，喂给 churn 干预；对齐 web 仅对 onboarding 特殊处理）。 */
    private deriveLifecycleStage(): LifecycleStage {
        const g = this.stats.totalGames;
        if (g < 3) return 'onboarding';
        if (g < 20) return 'exploration';
        return 'growth';
    }

    /** 由等级推导成熟度 band（喂给 lifecyclePlaybook 矩阵）。 */
    private deriveMaturityBand(): Band {
        const lv = this.progression.level;
        if (lv < 3) return 'M0';
        if (lv < 8) return 'M1';
        if (lv < 15) return 'M2';
        if (lv < 25) return 'M3';
        return 'M4';
    }

    /** tone → 提示强调色（统一各类 toast 的「语气」视觉，对齐矩阵 intent 的情绪基调）。 */
    private toneAccent(tone: Tone): Color {
        switch (tone) {
            case 'supportive': return new Color(120, 200, 150, 255);
            case 'inviting': return new Color(110, 170, 255, 255);
            case 'challenge': return new Color(255, 150, 90, 255);
            case 'steady': return new Color(110, 210, 210, 255);
            case 'rising': return new Color(255, 190, 90, 255);
            case 'rewarding': return new Color(255, 215, 120, 255);
            default: return new Color(170, 190, 210, 255);
        }
    }

    /**
     * 生命周期策略意图提示（落地 lifecyclePlaybook 矩阵的「提示语气」侧）：
     * 由 (stage, band) 经矩阵取主导 intent 的局内叙事，按其 tone 上色，每日一次 bar toast。
     * 对齐 web strategyAdvisor #14「S/M 生命周期策略」把矩阵意图呈现给玩家——非新手才显（S0 阶段不打扰）。
     *
     * v1.69.3：移动端（含 Cocos iOS / Android 原生包、微信小程序）**默认不显示**算法
     * 决策类叙事文案。INTENT_LEXICON 中的 narrativeZh 含「投放促清/识别到密集消行机会/
     * 系统略加压」等算法泄露式描述，仅适合 web 主端 debug 面板；对终端用户应隐藏。
     *
     * 启用方式（如需在 Cocos 上恢复显示用于调试）：构建期注入
     * `globalThis.__OB_COCOS_STRATEGY_HINT__ = true`。
     */
    private maybeShowStrategyHint(): void {
        if (!this.node?.isValid) return;
        if (!(globalThis as any).__OB_COCOS_STRATEGY_HINT__) return;
        const stage = this.deriveLifecycleStage();
        if (stage === 'onboarding') return;
        const today = dateKey();
        if (Storage.get(STORAGE_KEYS.strategyHint, '') === today) return;
        const band = this.deriveMaturityBand();
        const intent = primaryIntent(stage, band);
        const text = intentNarrative(intent);
        if (!text) return;
        Storage.set(STORAGE_KEYS.strategyHint, today);
        Toast.show({ text, tier: 'bar', durationMs: 6000, accent: this.toneAccent(toneFor(stage, band)) });
    }

    /**
     * 流失召回干预（移植 web churnPredictor.getChurnIntervention 的玩家可见面）：
     * 当流失风险达 medium 以上且当日未发过 → 自动发放召回礼包（token + 金币）并 celebrate/bar toast 告知。
     * 风险数据来自每局结束写入的会话指标（见 settle → ChurnPredictor.recordSession），新装/活跃玩家风险为 0、不会打扰。
     */
    private maybeShowChurnIntervention(): void {
        if (!this.node?.isValid) return;
        const plan = ChurnPredictor.consumeIntervention(this.deriveLifecycleStage());
        if (!plan) return;
        const wallet = this.model.wallet;
        for (const k of Object.keys(plan.tokens) as (keyof typeof plan.tokens)[]) {
            const v = plan.tokens[k];
            if (v) wallet.addBalance(k as WalletKind, v, `churn-${plan.level}`);
        }
        if (plan.coins > 0) wallet.earn(plan.coins);
        this.hud.setCoins(wallet.coins);
        this.skillBar.refresh();
        this.save();
        // critical/high 用 celebrate（更显眼的召回），medium 用 bar 轻提示。
        const tier = plan.level === 'medium' ? 'bar' : 'celebrate';
        // 召回属 winback(S4) 段：用矩阵该段主导语气上色，使提示语气与运营意图一致。
        const accent = this.toneAccent(toneFor('winback', this.deriveMaturityBand()));
        Toast.show({ text: t(plan.messageKey), tier, durationMs: tier === 'celebrate' ? 5000 : 6000, accent });
    }

    /**
     * 季节推荐 toast（移植 web seasonalSkin.js：节日 / 周末 / 生日）。判定 + 反打扰持久化在 seasonalRecommend 模块，
     * 这里执行副作用：节日 → 带「切换」按钮（celebrate，8s，对齐 web）；周末/生日 → 发放试穿券后 celebrate 告知。
     */
    private maybeShowSeasonalToasts(): void {
        // 节日推荐（每日一次；已是该皮肤则不显切换按钮）。
        // 节日推荐走 bar tier（对齐 web #seasonal-toast：顶部条 + 可选「切换」按钮）。
        const fest = consumeFestivalRecommendation();
        if (fest) {
            const sameSkin = this.model.skin.id === fest.skin;
            Toast.show({
                text: t('toast.seasonalRecommend', { msg: fest.msg }),
                tier: 'bar',
                durationMs: 8000,
                actionLabel: sameSkin ? undefined : t('toast.seasonalAction'),
                onAction: sameSkin ? undefined : () => this.applySkin(fest.skin),
            });
        }
        // 周末试穿券（本周一次）；bar tier 信息提示（对齐 web #seasonal-toast 周末文案）。
        const weekend = consumeWeekendTrial();
        if (weekend && listSkinIds().includes(weekend.skinId)) {
            this.model.wallet.addTrial(weekend.skinId, weekend.hours);
            this.skillBar.refresh();
            this.save();
            Toast.show({
                text: t('toast.weekendTrial', { name: getSkin(weekend.skinId).name }),
                tier: 'bar',
                durationMs: 7000,
            });
        }
        // 生日礼包（本年一次）。
        const bday = consumeBirthdayGift();
        if (bday && listSkinIds().includes(bday.skinId)) {
            this.model.wallet.addTrial(bday.skinId, bday.hours);
            this.model.wallet.addBalance('hintToken', bday.hintTokens, 'birthday');
            this.model.wallet.addBalance('rainbowToken', bday.rainbowTokens, 'birthday');
            this.hud.setCoins(this.model.wallet.coins);
            this.skillBar.refresh();
            this.save();
            Toast.show({ text: t('toast.birthday'), tier: 'celebrate', durationMs: 6000 });
        }
    }

    /**
     * 是否存在可继续的存档（供主菜单决定主按钮文案：继续/开始）。
     * 注意：本方法可能在 start() 把存档读入 model 之前被调用，故只依据存档 JSON 本身判断，
     * 不读 live model 状态。存档存在且未处于结束态即视为可继续。
     */
    hasResumableSave(): boolean {
        const saved = Storage.getJSON<{ gameOver?: boolean } | null>(STORAGE_KEYS.save, null);
        return !!saved && saved.gameOver !== true;
    }

    /** 从主菜单进入：所选模式与当前不同（或已结束）则开新局，否则继续；随后跑入场流程。 */
    enterFromMenu(mode: GameMode, onDone?: () => void): void {
        // 「从主菜单进入」= web 主菜单按钮路径：runStreak 归零（连战链断开）。
        // 即便 mode 与当前一致、不走 startGame 分支，回菜单的语义也已断链，故无条件清零。
        this.playerCtx.resetRunStreak();
        if (mode !== this.model.mode || this.model.gameOver) {
            this.startGame(mode);
        }
        this.runEntryFlow(onDone);
    }

    /** 入场流程：回归礼包 / 首日礼包（菜单关闭后调用）。 */
    runEntryFlow(onDone?: () => void): void {
        this.maybeWelcomeBack(onDone);
    }

    /** 用指定模式开新局（重置计时）。 */
    startGame(mode: GameMode): void {
        guard('GameController.startGame', () => this.startGameImpl(mode));
    }

    /**
     * 每日大师题（移植 web dailyMaster.startChallenge）：建立日固定种子后开一局专题局，结算时记录战绩。
     * 每日仅可挑战一次；已完成则给提示不再开局。由主菜单「每日大师题」入口触发。
     */
    startDailyMaster(): void {
        if (DailyMaster.isPlayedToday()) {
            Toast.show({ text: t('dailyMaster.alreadyPlayed'), tier: 'bar', durationMs: 4500 });
            return;
        }
        const seed = DailyMaster.begin();
        AudioManager.sfxUnlock();
        Haptics.medium();
        this._dailyMasterStarting = true;
        this.startGame(this.model.mode);
        this._dailyMasterStarting = false;
        Toast.show({
            text: t('dailyMaster.toastSeed', { seed: seed.toString(36).toUpperCase() }),
            tier: 'celebrate',
            durationMs: 4500,
        });
    }

    private startGameImpl(mode: GameMode): void {
        // 开新局前清掉残留拖拽，避免 ghost / 选中槽残影。
        this.cancelDrag();
        // 作废上一局仍在排队、尚未播放的非模态浮条，避免跨局串台（对齐 web _toastGeneration）。
        Toast.bumpGeneration();
        // 非「每日大师题」开局：撤销可能残留的日固定种子，避免普通局被上一次挑战的 PRNG 污染出块。
        if (!this._dailyMasterStarting) DailyMaster.end();
        // 新局兜底：Modal 计数器漂移 / 因弹窗异常残留 → 玩家进入新局后会立刻发现「点啥都没反应」。
        // 这里在所有合法 modal 都应该已关闭的时机（新局开始）强制清零，给玩家干净的起点。
        // 注意：仅当此时 GameController.node 下确实没有 modal-like 节点时才 reset，避免误关合法弹窗。
        if (Modal.isOpen() && !this.hasAnyModalLikeChild()) {
            console.warn('[OpenBlock] startGame: stale Modal counter detected, resetting');
            Modal.reset();
        }
        this._modalBlockSinceMs = 0;
        this.model.setMode(mode);
        Storage.set(STORAGE_KEYS.mode, mode);
        this.settled = false;
        this.prevBest = this.model.best;
        this.game = { clears: 0, maxCombo: 0, placements: 0, misses: 0, startMs: Date.now(), pbBaseline: this.model.best };
        this._celebratedNewBest = false;
        this.resetNearMiss();
        // 重置玩家画像（保留 best 作为本局 PB 基线）。
        this.playerCtx.reset(this.model.best);
        // 真实 PlayerProfile 也开新局（清局内派生计数，保留跨局技能/会话历史）。
        this.profile?.recordNewGame?.();
        if (GAME_RULES_DATA?.sessionEvaluation?.enabled !== false) {
            try { evalOnSessionStart(this as any); } catch { /* evaluation 失败不阻塞 */ }
        }
        /* 出块引擎跨局态清理（与 web `game.js` line 1450-1451 严格同址）：
         *   - 清掉模块级 `_prevScoreMilestone` —— 否则上一局到 5000 分留下的"已触发到 5000 档"残值
         *     会让新局 0~5000 区间所有里程碑全部 miss，blockSpawn gapFill ×1.3 加权失效；
         *   - 清掉 blockSpawn `_spawnMemory.categories` —— 否则新局首副 dock 的新鲜度带偏；
         *   - 清掉本闭包 `ctx` —— 否则 specialShapeUsed / dupInjectUsed / _lastSpawnIntent 跨局污染。
         * 必须在 model.newGame() 触发首副 dock 出块之前调用。 */
        this.spawner?.resetForNewGame();
        this._pendingPlaceFill = -1;
        this._pendingClearLines = 0;
        this.timeLeft = getMode(mode).timeLimitSec;
        this.hud.setTimeLeft(this.timeLeft > 0 ? this.timeLeft : null);
        this.hud.setGameOver(false);
        this.hud.resetScore();
        this.resetInPlayHud();
        this.model.newGame();
        // 新开局：重置回放录制（记录本局每一步落子）。
        this.replay.begin(this.model.grid.size, mode, this.model.skin.id, this.model.best);
        this.hud.setBest(this.model.best);
        this.renderAll();
        // 新开局是干净画面：把上一局攒够阈值的赛季宝箱在此庆祝发放（对齐 web 不与结算卡叠层）。
        this.grantSeasonChests(true);
        // 持久化新开局：避免存档仍停留在上一局（含旧分/结束态），与 web 重开即落库一致。
        this.save();
    }

    /**
     * 赛季进阶宝箱结算（对齐 web `seasonChest.js`）：按生涯累计经验跨阈值发放金币。
     * celebrate=true 时弹「🏆 {名} 已解锁」庆祝飘字 + unlock 音 + 重震动；
     * false 时静默补发（如启动 catch-up，避免在非对局画面强插庆祝）。
     */
    private grantSeasonChests(celebrate: boolean): void {
        const unlocked = this.seasonChest.check(this.progression.totalXp);
        if (unlocked.length === 0) return;
        const wallet = this.model.wallet;
        let yOff = 60;
        for (const tier of unlocked) {
            const source = `season-chest-${tier.id}`;
            // token 礼包入账（来源已豁免每日上限）。
            for (const [k, v] of Object.entries(tier.reward)) {
                wallet.addBalance(k as WalletKind, v as number, source);
            }
            // 史诗/传说附带限时试穿券。
            if (tier.trial) {
                const [skinId, hours] = tier.trial;
                if (listSkinIds().includes(skinId)) wallet.addTrial(skinId, hours);
            }
            if (celebrate) {
                const label = t(`seasonChest.${tier.id}`);
                this.fx.floatText(t('seasonChest.unlocked', { label }), new Color(255, 215, 120, 255), yOff);
                yOff += 56; // 多阶同时解锁时纵向错开
            }
        }
        if (celebrate) { AudioManager.sfxUnlock(); Haptics.heavy(); }
        this.hud.setCoins(wallet.coins);
        this.skillBar.refresh();
        this.save();
    }

    /** 清空局内 HUD 浮层（combo 心形 + 追 PB「差 N 分」横幅），新开局/续局时调用。 */
    private resetInPlayHud(): void {
        this.hud.setCombo(0);
        this.hud.setBestGap('', 'none');
    }

    /** 重置「差一行」近失鼓励的单局控频状态（新开局 / 重开调用）。 */
    private resetNearMiss(): void {
        this._nearMissToastCount = 0;
        this._nearMissLastPlacement = null;
        this._nearMissLastShownMs = null;
    }

    /**
     * 刷新追 PB「差 N 分 / 本局 +N」横幅（对齐 web `#best-gap`）。
     * 仅无尽类模式、存在开局 PB 基线、且本局已落子 ≥3（warmup 门槛，避免开局即刷屏）时显示。
     */
    private refreshBestGap(score: number): void {
        const base = this.game.pbBaseline;
        if (this.model.modeDef.timeLimitSec > 0 || base <= 0 || this.game.placements < 3) {
            this.hud.setBestGap('', 'none');
            return;
        }
        if (score < base) {
            this.hud.setBestGap(t('hud.bestGap', { n: base - score }), 'gap');
        } else if (score > base) {
            this.hud.setBestGap(t('hud.bestOver', { n: score - base }), 'over');
        } else {
            this.hud.setBestGap('', 'none');
        }
    }

    /**
     * 局内破纪录庆祝（对齐 web `_maybeCelebrateNewBest`）：本局得分严格超过开局 PB 基线时，
     * 弹一次「🏆 刷新最佳！」中央飘字 + 一次完美闪光（每局最多一次，避免反复触发）。
     */
    private maybeCelebrateNewBest(score: number): void {
        const base = this.game.pbBaseline;
        if (this._celebratedNewBest || base <= 0 || score <= base) return;
        this._celebratedNewBest = true;
        // 破纪录释放窗口（对齐 web `_startPostPbReleaseWindow`，v1.55 §4.9）：
        // 接下来 5 次 spawn stress×0.7 + clearGuarantee+1 + challengeBoost 禁用，留出"我赢了"情绪释放时间；
        // 局内只激活一次（PlayerContext 内 used cooldown）。
        this.playerCtx.triggerPostPbRelease();
        // 对齐 web `new-best-popup`：局内破纪录用中心庆贺 popup（celebrate Toast，hold 2300ms，每局一次），
        // 取代原裸 floatText —— 走统一队列，避免与其它庆贺浮条视觉黏连。
        Toast.show({ text: t('effect.newRecord'), tier: 'celebrate', durationMs: 2300, accent: new Color(255, 215, 120, 255) });
        ScreenShake.shake(this.shakeTarget, 10, 0.3);
        Haptics.heavy();
        AudioManager.sfxBonus();
    }

    update(dt: number): void {
        // 自适应帧率：空闲(无交互/动画)时降到 30fps 散热省电，交互/消行期由 poke() 顶到 60fps。
        FrameRate.tick();
        // 拖拽看门狗：任何被吞的 TOUCH_END / TOUCH_CANCEL 都会让 dragIndex 永久 >=0，
        // 后续 onTouchStart 虽然能 heal，但用户首次报错"为什么按一下没反应"已发生。
        // 这里在心跳超时（无 MOVE/END）时主动清，确保僵尸态最长存活时间有上限。
        this.dragWatchdogTick();
        // gameOver 卡死自愈：model.gameOver 为真却无任何结算/复活面板时，重新弹结算卡，
        // 否则候选块会被 gameOver 守卫永久拦死且无退出 UI（见常量 GAMEOVER_NO_PANEL_HEAL_MS）。
        this.gameOverHealTick();
        // lift 时间驱动：dragMoved 后 LIFT_RAMP_MS 内推进 _liftFactor 0→1，
        // 即使手指停在原地不动也持续渐进——水平 horizontal motion 与垂直 lift 解耦的关键。
        this.advanceLiftRamp();
        if (this.model.modeDef.timeLimitSec <= 0) return;
        if (this.model.gameOver || Modal.isOpen()) return;
        if (this.timeLeft <= 0) return;
        this.timeLeft -= dt;
        this.hud.setTimeLeft(this.timeLeft);
        if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            this.model.endByTime();
        }
    }

    /**
     * lift 时间驱动渐进：dragMoved 翻 true 起 LIFT_RAMP_MS 内把 _liftFactor 推到 1。
     * 关键：手指停在原地（无 touch-move 事件）时 update() 仍按帧推进，让 ghost 自动上抬到位 ——
     * 这是「水平方向按触屏倍率跟手 + 垂直 lift 平滑独立」的实现核心。
     */
    private advanceLiftRamp(): void {
        if (this.dragIndex < 0 || !this.dragMoved) return;
        if (this._liftFactor >= 1) return;
        const elapsed = Date.now() - this._dragMovedAtMs;
        const linear = Math.min(1, elapsed / LIFT_RAMP_MS);
        // easeOutCubic：1 - (1-t)³
        //   linear 0.30 → eased 0.66    （前 30% 时间完成 2/3 抬升，立即感受到方块到位）
        //   linear 0.60 → eased 0.94    （半程之后已基本到顶）
        //   linear 1.00 → eased 1.00
        const t = 1 - linear;
        const eased = 1 - t * t * t;
        if (eased <= this._liftFactor) return;
        this._liftFactor = eased;
        // 用最近一次 touch 坐标重摆 ghost（手指此刻可能在动也可能不在动，都走这条路统一）。
        this.repositionGhost(this._lastTouchScreenX, this._lastTouchScreenY);
    }

    /**
     * 拖拽看门狗（源头防线）：周期性检查 dragIndex 已激活但 dragLastSeenAtMs 太久没刷新的僵尸态。
     *
     * 必须区分两种 dragIndex>=0 的语义，否则会误伤合法交互：
     *  · 进行中拖拽（手指应仍按住，dragMoved 或处于 deferred-tap 待定）：idle 超时几乎一定是平台
     *    吞掉了 END/CANCEL（iOS 边缘手势 / 安卓沉浸式 surfaceChanged / WebView 接管触摸）。这种残留态
     *    若拖到下一次 touch-start 才被 heal，正是「候选块激活不了」「触摸 END 风暴」的源头前兆，
     *    故用较短的 DRAG_STALE_TIMEOUT_MS 主动回收，把僵尸态存活时间从源头压上限。
     *  · 悬浮选中（_tapSelected 且无待定动作、未发生位移）：手指已抬起、方块悬停等下一次点击，是合法
     *    长驻态（玩家在思考落点）。此态天然没有 TOUCH_MOVE 刷新心跳，若沿用 3.5s 会把玩家选中的方块
     *    无故取消 —— 因此只用很大的 DRAG_HOVER_STALE_MS 兜底极端僵尸，正常思考时间内绝不打扰。
     *
     * 注意：本看门狗是「JS 侧」防线，只在 update() 还能跑（主线程未冻）时生效。安卓原生渲染线程被
     * 交换链/EGL surface 重建顶死那条故障链，由 Bootstrap 的分辨率锁定 + onTouchEnd 的事件风暴速率
     * 守卫从原生侧兜底，二者互补。
     */
    private dragWatchdogTick(): void {
        if (this.dragIndex < 0) return;
        if (this.dragLastSeenAtMs <= 0) return;
        const idle = Date.now() - this.dragLastSeenAtMs;
        const isHoverSelect = this._tapSelected && this._pendingTapAction == null && !this.dragMoved;
        const limit = isHoverSelect ? DRAG_HOVER_STALE_MS : DRAG_STALE_TIMEOUT_MS;
        if (idle < limit) return;
        console.warn(`[OpenBlock] drag watchdog reset (idle=${idle}ms idx=${this.dragIndex} touchId=${this.dragTouchId} hover=${isHoverSelect ? 1 : 0} moved=${this.dragMoved ? 1 : 0})`);
        this.cancelDrag();
        // 悬浮选中被回收后，dock 槽需重绘回「未选中」态，避免残留高亮/缺块视觉。
        if (isHoverSelect) {
            try { this.dock.render(this.model.dock, this.model.skin); } catch { /* ignore */ }
        }
    }

    /**
     * gameOver 卡死自愈：model.gameOver 为真但场景内没有任何结算/复活面板（Modal 计数为 0）。
     *
     * 正常结算链中 onGameOver → showReviveOverlay(ModalPanel) 或 settle()→GameOverPanel，二者都会
     * Modal.open()，因此 gameOver 期间 Modal.isOpen() 恒为真。若出现 gameOver=true 却 Modal 计数为 0，
     * 说明面板没弹出来（build 抛错 / 事件链被异常打断），此时 onTouchStart 会被 gameOver 守卫永久
     * 拦死、又没有可见 UI 让玩家退出——正是「玩到中途三个候选块全部无法激活、且看不到弹窗」的成因。
     *
     * 持续超过 GAMEOVER_NO_PANEL_HEAL_MS 即重新弹出结算卡（settle 已跑则只重弹展示层，不重复结算）。
     */
    private gameOverHealTick(): void {
        if (!this.model.gameOver || Modal.isOpen() || this._reviveAdPending) { this._gameOverHealAtMs = 0; return; }
        const now = Date.now();
        if (this._gameOverHealAtMs === 0) { this._gameOverHealAtMs = now; return; }
        if (now - this._gameOverHealAtMs < GAMEOVER_NO_PANEL_HEAL_MS) return;
        const elapsed = now - this._gameOverHealAtMs;
        this._gameOverHealAtMs = 0;
        console.warn(`[OpenBlock] gameOver heal: no settlement panel for ${elapsed}ms → re-present (settled=${this.settled})`);
        try {
            if (this.settled && this._settleDisplay) {
                this.showGameOverPanel(this._settleDisplay.xpGain, this._settleDisplay.leveledUp, this._settleDisplay.level);
            } else {
                this.settle();
            }
        } catch (err) {
            console.warn('[OpenBlock] gameOver heal failed', err);
        }
    }

    onEnable(): void {
        console.log('[OpenBlock] GameController.onEnable: registering global touch listeners');
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        // TOUCH_CANCEL（iOS app 切后台/系统手势接管/WKWebView 滑屏冲突）必须无条件清理 drag 状态，
        // 否则会出现"候选块再也激活不了"的僵尸态。这里独立挂钩，不与 END 复用，避免被 isOwnTouch 过滤。
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    onDisable(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    // ---- model events ----

    private onModelEvent(e: GameEvent): void {
        try { this.onModelEventImpl(e); } catch (err) { reportFatal(`onModelEvent:${e.type}`, err); }
    }

    private onModelEventImpl(e: GameEvent): void {
        switch (e.type) {
            case 'dock':
                this.dock.render(this.model.dock, this.model.skin);
                this.playerCtx.resetBottleneck();
                try {
                    evalOnSpawn(this as any, this.model.dock.map((b: any) => ({ shape: b?.shape, data: b?.shape })));
                } catch { /* ignore */ }
                break;
            case 'place': {
                this.game.placements++;
                this.fx.flashPlacement(e.shape, e.gx, e.gy, blockColor(this.model.skin, e.colorIdx));
                // 「妙手」激励 👍（对齐 web `_checkToughPlacement` / `_showThumbsUp`）：
                // 由 GameModel 在落子前评估 fillBefore/validsBefore + 死局守卫后挂在 'place' 事件上。
                // 视觉特效总开关关闭时不弹（与 web 一致——属玩法外的"装饰性赞美"）。
                if (e.praise?.brilliant && VisualFx.enabled) {
                    this.fx.showThumbsUp();
                    Haptics.light();
                    Analytics.track(ANALYTICS_EVENTS.toughPlacement, {
                        fill: Math.round(e.praise.fillBefore * 100) / 100,
                        valids: e.praise.validsBefore,
                    });
                }
                // 回放录制：记一帧落子（确定性重建用）。
                this.replay.recordPlace(e.shape, e.colorIdx, e.gx, e.gy);
                AudioManager.sfxPlace();
                Haptics.light();
                this.meta.recordPlace();
                this.save();
                const hasRemainingDockBlocks = this.model.dock.some((b) => b && !b.placed);
                // PlayerProfile 需要最终盘面（含本次消行结算后）的 fill 与清线数。
                // GameModel 同步发出 place → clear/score，因此延后一帧 flush，保证 clear handler
                // 已写入 _pendingClearLines，口径对齐 web `recordPlace(result.count>0, count, fill)`。
                this._pendingClearLines = 0;
                this.scheduleOnce(() => {
                    const lines = this._pendingClearLines;
                    const fill = this.model.grid.getFillRatio();
                    try { this.profile?.recordPlace?.(lines > 0, lines, fill); } catch { /* ignore */ }
                    if (hasRemainingDockBlocks) this.updateBottleneckTrough();
                    this._pendingPlaceFill = fill;
                    this._pendingClearLines = 0;
                    try { this.profile?.save?.(); } catch { /* ignore */ }
                }, 0);
                // 记下落子中心格（用于 score 飘字定位到玩家视线焦点附近）。
                this._lastPlaceCenter = {
                    gx: e.gx + (e.shape[0]?.length ?? 1) / 2 - 0.5,
                    gy: e.gy + e.shape.length / 2 - 0.5,
                };
                this._nextScoreKind = 'normal';
                // 连续消行 streak 终止判定：本次落子后下一帧若未触发 'clear'（reason='line'），
                // 说明 streak 中断（落子无消），归零。'clear' handler 会先将 streak +1，故此处用快照对比。
                {
                    const before = this._clearStreak;
                    this.scheduleOnce(() => {
                        if (this._clearStreak === before) {
                            this._clearStreak = 0;
                            // 落子未消行 → combo 链中断，淡出 combo 心形（对齐 web combo-heart fading）。
                            this.hud.setCombo(0);
                        }
                    }, 0);
                }
                break;
            }
            case 'score':
                this.hud.setScore(e.score);
                this.hud.setBest(this.model.best);
                this.meta.recordScore(e.score);
                // 玩家画像：里程碑感知（喂给引擎做 gapFill 加权）。
                this.playerCtx.onScore(e.score);
                // 对齐 web `showFloatScore`：本次得分增量 ≥1 时飘出 `+N`，定位到最近落子格上方。
                // kind 由 'clear' 事件设置（perfect/combo），随后被 'score' 消费并归零为 normal。
                if (e.delta > 0) {
                    const center = this._lastPlaceCenter;
                    this.fx.showScoreFloat(e.delta, this._nextScoreKind, center?.gx, center?.gy, this._nextScoreLabel ?? undefined);
                    this._nextScoreKind = 'normal';
                    this._nextScoreLabel = null;
                }
                // 追 PB「差 N 分 / 本局 +N」横幅 + 局内破纪录庆祝（对齐 web in-play PB 反馈）。
                this.refreshBestGap(e.score);
                this.maybeCelebrateNewBest(e.score);
                break;
            case 'nearmiss': {
                // 「差一行」近失鼓励：展示与否严格对齐 web `shouldShowNearMissPlaceFeedback`
                // —— 必须本次落子贴到近满线（binding）、体感很差（连续未消行 ≥4 且非顺风）、
                // 过了冷启动期，且单局至多 1 次、落子间隔 ≥12、时间冷却 ≥30s。
                const now = Date.now();
                const decision = shouldShowNearMiss({
                    nearFullLines: e.lines,
                    placedCells: e.placedCells,
                    maxLineFill: e.maxLineFill,
                    frustrationLevel: this.model.roundsSinceLastClear,
                    momentum: this.playerCtx.momentum(),
                    toastCount: this._nearMissToastCount,
                    lastPlacementIndex: this._nearMissLastPlacement,
                    currentPlacementIndex: this.game.placements,
                    lastShownAt: this._nearMissLastShownMs,
                    now,
                });
                if (decision.show && decision.line) {
                    this._nearMissToastCount++;
                    this._nearMissLastPlacement = this.game.placements;
                    this._nearMissLastShownMs = now;
                    this.fx.flashNearMiss([decision.line]);
                    Haptics.light();
                    // 对齐 web `_triggerNearMissFeedback` 渲染：单容器内含 `<label>` 文案 + `<pts>` emoji 双行，
                    // 共享同一组缩放/位移关键帧（nearMissFloat 2.8s）。详见 FxLayer.showNearMiss。
                    this.fx.showNearMiss(t('effect.nearMissPlace'));
                }
                break;
            }
            case 'revive':
                this.fx.floatText(t('revive.done'), new Color(140, 255, 180, 255));
                break;
            case 'clear': {
                // 消行高亮 + 碎屑粒子要在 60fps 下播放，维持高帧覆盖整个特效余韵窗口。
                FrameRate.poke();
                this.lineFx.play(e.result, this.model.skin, { perfectClear: e.perfectClear });
                this.fx.burstClear(e.result, this.model.skin, { perfectClear: e.perfectClear });
                // 全屏闪光层（对齐 web playClearEffect 主路径）：
                //   bonus 同色/同 icon → 紫金光晕 + icon 喷涌；perfect → 彩虹脉冲；
                //   combo(≥3) → 暖金光晕；double(==2) → 沿消除行水平涟漪。
                {
                    const bonusLines = e.result.bonusLines || [];
                    if (bonusLines.length > 0) {
                        this.overlayFx.triggerBonusMatchFlash(bonusLines.length);
                        const iconSpecs = bonusLines
                            .map((bl) => ({ type: bl.type, idx: bl.idx, icon: blockIcon(this.model.skin, bl.colorIdx) || '' }))
                            .filter((s) => !!s.icon);
                        // 持续喷涌时长 = web bonusEffectHoldMs(bonusCount)：3000-5000ms。
                        // 与 LineClearFx 主消行特效 baseDuration 协同；overlayFx 内部会取 max(520, durationMs)。
                        if (iconSpecs.length) this.overlayFx.bonusIconGush(iconSpecs, bonusEffectHoldMs(bonusLines.length));
                    }
                    if (e.perfectClear) this.overlayFx.triggerPerfectFlash();
                    else if (e.result.count >= 3) this.overlayFx.triggerComboFlash(e.result.count);
                    else if (e.result.count === 2) this.overlayFx.triggerDoubleWave(e.result.rows || []);
                }
                if (e.reason === 'line') {
                    this._pendingClearLines = Math.max(this._pendingClearLines, e.result.count || 0);
                    // 玩家画像：消行节奏（清零 roundsSinceClear、累计 totalClears，喂给引擎纾困/特殊配额）。
                    this.playerCtx.onClear(e.result.count);
                    this.recordSeasonEvent('clears', e.result.count);
                    // 伙伴亲密度：消行 +XP 并庆祝（升级时飘字）。
                    const cv = this.companionView;
                    if (cv) {
                        const before = this.companion.level();
                        if (this.companion.addXp(e.result.count) && this.companion.level() > before) {
                            this.fx.floatText(t('companion.levelup', { n: this.companion.level() }), new Color(255, 220, 130, 255));
                        }
                        cv.react();
                        cv.setLevel(this.model.skin.id, this.companion.level());
                    }
                    this.meta.recordLines(e.result.count);
                    this.daily.addDishProgress(e.result.count);
                    // 赛季 XP 不在局内逐次消行累计——与 web 一致，仅在 settle() 按本局得分+消行结算一次。
                    this.stats.totalLines += e.result.count;
                    this.stats.maxComboLines = Math.max(this.stats.maxComboLines, e.result.count);
                    // 本局战报：累计消行数 + 单手最大消行数（对齐 web gameStats.clears / maxCombo）。
                    this.game.clears += e.result.count;
                    this.game.maxCombo = Math.max(this.game.maxCombo, e.result.count);
                    Analytics.track(ANALYTICS_EVENTS.clear, { count: e.result.count });
                    if (e.result.count >= 2) Analytics.track(ANALYTICS_EVENTS.multiClear, { count: e.result.count });
                }
                if (e.reason === 'line') {
                    // 连续消行 streak：本次有消则 +1，落子未消会在 case 'place' 末尾归零。
                    this._clearStreak++;
                    // combo 心形 HUD（对齐 web `#combo-heart`）：连续消行计数 ≥2 时常驻显示。
                    this.hud.setCombo(this._clearStreak);
                }
                // combo 倍数后缀（对齐 web showFloatScore 的 `· combo ×N` 拼接）：>1 时统一追加，
                // 任何档位（普通/双消/多消/清屏/同花顺）都会带上，提示玩家本次得分被 combo 加成。
                const comboMult = Number(e.comboMultiplier ?? 1) || 1;
                const comboMultTxt = comboMult > 1
                    ? (Number.isInteger(comboMult) ? ` · combo ×${comboMult}` : ` · combo ×${comboMult.toFixed(1)}`)
                    : '';
                const bonusLineCount = (e.result.bonusLines || []).length;
                if (e.perfectClear) {
                    AudioManager.sfxPerfect();
                    // 飘字标签合并进 `+N`（清屏 ×10 / +N），与 web float-perfect 一致。
                    ScreenShake.shake(this.shakeTarget, 18, 0.4);
                    Haptics.heavy();
                    this.profile?.recordDelight?.('pcClear');
                    this.stats.perfectClears++;
                    Analytics.track(ANALYTICS_EVENTS.perfectClear, {});
                    this._nextScoreKind = 'perfect';
                    this._nextScoreLabel = t('effect.perfectFloat') + comboMultTxt;
                } else if (e.reason === 'line') {
                    AudioManager.sfxClear(e.result.count);
                    const lines = e.result.count;
                    if (lines >= 2) {
                        // 双消走 multi 档位（CSS .float-multi 绿色 0.9s），多消走 combo（CSS .float-combo 橙色 1.5s）。
                        const base = lines === 2 ? t('effect.double') : t('effect.multi', { n: lines });
                        this._nextScoreLabel = base + comboMultTxt;
                        AudioManager.sfxCombo(lines);
                        ScreenShake.shake(this.shakeTarget, 8 + lines * 2, 0.3);
                        this.profile?.recordDelight?.('multiClear');
                        Analytics.track(ANALYTICS_EVENTS.comboHigh, { count: lines });
                        this._nextScoreKind = lines === 2 ? 'multi' : 'combo';
                    } else if (comboMult > 1) {
                        // 单消但 combo 倍数生效：标签退化为 `Combo ×N`（对齐 web `hasComboMult` 单消分支）。
                        const multTxt = Number.isInteger(comboMult) ? `×${comboMult}` : `×${comboMult.toFixed(1)}`;
                        this._nextScoreLabel = t('effect.comboMultiplier', { mult: multTxt });
                        this._nextScoreKind = 'combo';
                    }
                    // 同色 / 同 icon 行（bonusLines）：覆盖标签为「同花顺大消除」，配 bonus 档位字号。
                    // 对齐 web hasIconBonus 分支 —— bonus 是金色专属档位，盖过 combo/multi 标签。
                    if (bonusLineCount > 0) {
                        this._nextScoreLabel = t('effect.iconBonus') + comboMultTxt;
                        this._nextScoreKind = 'bonus';
                        AudioManager.sfxBonus();
                        Haptics.heavy();
                    }
                    // 连续 ≥3 次消行：弹 streak 徽章 + bonus 音（对齐 web `streak-badge`），>1 时同时显示 Combo ×N。
                    if (this._clearStreak >= 3) {
                        this.fx.showStreakBadge(this._clearStreak, comboMult);
                        AudioManager.sfxBonus();
                        Haptics.heavy();
                        if (this._clearStreak >= 4) this.profile?.recordDelight?.('comboHigh');
                    }
                    if (bonusLineCount > 0) this.profile?.recordDelight?.('monoFlush');
                    Haptics.medium();
                }
                this.save();
                break;
            }
            case 'wallet':
                this.hud.setCoins(e.coins);
                this.skillBar.refresh();
                this.save();
                break;
            case 'freeze':
                if (e.active) this.fx.floatText(t('freeze.on'), new Color(160, 220, 255, 255));
                if (e.used) this.fx.floatText(t('freeze.triggered'), new Color(160, 220, 255, 255));
                break;
            case 'gameover':
                this.onGameOver();
                break;
            default:
                break;
        }
    }

    // ---- 结算 / 复活 / 奖励 ----

    private onGameOver(): void {
        this.hud.setGameOver(true);
        this.hud.setTimeLeft(null);
        // checkGameOver / endByTime 已经在 model 内 commit 了新 PB（若本局确实超过旧 PB），
        // 这里立即把顶栏 HUD 的"最佳"刷新到新值，避免出现"结算卡显示新 PB 但顶栏仍是旧 PB"的撕裂感。
        this.hud.setBest(this.model.best);
        AudioManager.sfxGameOver();
        Storage.setNumber(STORAGE_KEYS.best, this.model.best);
        Analytics.track(ANALYTICS_EVENTS.gameOver, { score: this.model.score, mode: this.model.mode });
        Leaderboard.submit(this.model.best);
        this.save();
        try {
            evalOnGameOver(this as any, {
                finalScore: this.model.score,
                survivedSteps: this.game.placements,
                placedCount: this.game.placements,
                linesCleared: this.game.clears,
                maxCombo: this.game.maxCombo,
                runDurationMs: Date.now() - this.game.startMs,
                endCause: 'normal',
                pbAfter: this.model.best,
            });
        } catch { /* ignore */ }

        const cfg = getConfig();
        if (flag('revive') && this.model.reviveCount < cfg.reviveMaxPerGame) {
            this.showReviveOverlay();
        } else {
            this.settle();
        }
    }

    private showReviveOverlay(): void {
        Analytics.track(ANALYTICS_EVENTS.reviveShow, { n: this.model.reviveCount });
        const cfg = getConfig();
        const cost = cfg.reviveCostCoins * (this.model.reviveCount + 1);
        ModalPanel.show(this.node, {
            title: t('revive.title'),
            lines: [t('hud.score', { n: this.model.score })],
            buttons: [
                {
                    label: t('revive.ad'),
                    primary: true,
                    color: new Color(70, 130, 90, 255),
                    // 点下即关弹窗 + 异步放广告：置 _reviveAdPending 让 gameOver 自愈避让，
                    // 广告回调（成功复活 / 失败结算）后清旗标。
                    onClick: () => {
                        this._reviveAdPending = true;
                        void Ads.rewarded(cfg.adUnitIds.revive || 'revive')
                            .then((ok) => { if (ok) this.doRevive(); else this.settle(); })
                            .finally(() => { this._reviveAdPending = false; });
                    },
                },
                {
                    label: t('revive.coins', { n: cost }),
                    color: new Color(120, 90, 60, 255),
                    // 金币不足：提示无效音并保持弹窗打开（返回 false），让玩家改选看广告或放弃，
                    // 避免「点了买不起的按钮反而直接结束本局」。
                    onClick: () => {
                        if (this.model.wallet.canAfford(cost)) { this.model.wallet.spend(cost); this.doRevive(); return; }
                        AudioManager.sfxInvalid();
                        return false;
                    },
                },
                { label: t('revive.giveup'), color: new Color(74, 80, 100, 255), onClick: () => this.settle() },
            ],
        });
    }

    private doRevive(): void {
        if (this.model.revive()) {
            Analytics.track(ANALYTICS_EVENTS.reviveUsed, { n: this.model.reviveCount });
            this.hud.setGameOver(false);
            if (this.model.modeDef.timeLimitSec > 0) { this.timeLeft = Math.max(this.timeLeft, 20); }
            this.renderAll();
        }
    }

    /** 结算：经验/赛季/成就/首胜，弹结算宝箱。 */
    private settle(): void {
        if (this.settled) return;
        this.settled = true;
        this.stats.totalGames++;

        const score = this.model.score;
        // 每日大师题收尾（移植 web _onChallengeEnd）：记录战绩（每日一次去重依据）+ 撤销种子 + 完成提示。
        if (DailyMaster.isActive()) {
            DailyMaster.markPlayed(score);
            DailyMaster.end();
            Toast.show({ text: t('dailyMaster.toastComplete', { score }), tier: 'celebrate', durationMs: 4500 });
        }
        this.recordSeasonEvent('games');
        if (score > 0) this.recordSeasonEvent('score_once', score);
        const xpGain = Math.floor(score / 10) + 5;
        const lvRes = this.progression.addXp(xpGain);
        if (lvRes.leveledUp) {
            this.fx.floatText(t('level.up', { n: lvRes.level }), new Color(180, 230, 255, 255));
            this.hud.setLevel(lvRes.level);
            Analytics.track(ANALYTICS_EVENTS.levelUp, { level: lvRes.level });
        }

        const fresh = this.achievements.evaluate({
            bestScore: this.model.best,
            totalLines: this.stats.totalLines,
            maxComboLines: this.stats.maxComboLines,
            totalGames: this.stats.totalGames,
            level: this.progression.level,
            perfectClears: this.stats.perfectClears,
        });
        let achReward = 0;
        for (const a of fresh) { achReward += a.reward; this.fx.floatText(t('ach.unlocked', { name: a.name }), new Color(255, 220, 130, 255)); }
        // 对齐 web `extremeAchievements.js:152` 等：成就解锁播 unlock 音（与 chest/换肤共用 cue）。
        if (fresh.length > 0) { AudioManager.sfxUnlock(); Haptics.light(); }
        if (achReward > 0) this.model.wallet.earn(achReward);

        // 今日首胜金币加成（与宝箱解耦：web 宝箱只发道具，不含首胜倍率；此为 cocos 金币侧的每日激励）。
        if (score > 0 && this.daily.consumeFirstWin()) {
            const bonus = Math.round(getConfig().chestBaseCoins * this.daily.firstWinMultiplier());
            if (bonus > 0) {
                this.model.wallet.earn(bonus);
                this.fx.floatText(t('daily.firstwin', { n: this.daily.firstWinMultiplier() }), new Color(255, 220, 130, 255));
            }
        }
        // 流失预警写入会话指标（移植 web lifecycleOrchestrator.onSessionEnd 的唯一写入点）：
        // engagement = 时长(5 分钟饱和) 与 命中率(落子/(落子+误放)) 的等权综合，落入 [0,1]。
        {
            const tries = this.game.placements + this.game.misses;
            const hitRate = tries > 0 ? this.game.placements / tries : 1;
            const durMs = this.game.startMs > 0 ? Date.now() - this.game.startMs : 0;
            const durSaturated = Math.min(1, durMs / 300000);
            ChurnPredictor.recordSession({ duration: durMs, score, engagement: 0.5 * durSaturated + 0.5 * hitRate });
        }
        // 保存本局回放（无落子则不存）。
        ReplayStore.save(this.replay.finish(score));
        this.save();

        // 局末宝箱：先掷出结果（含概率/保底/分级 + token 礼包）并暂存，对齐 web —— 先弹「结算卡」，
        // 玩家点「再来一局」离开后再把命中的宝箱弹到新一局之上；未命中则只有结算卡。
        this._pendingChest = flag('rewards') ? this.rollChest(score) : null;
        this._settleDisplay = { xpGain, leveledUp: lvRes.leveledUp, level: lvRes.level };
        this.showGameOverPanel(xpGain, lvRes.leveledUp, lvRes.level);
    }

    /**
     * 局末宝箱掷点（严格对齐 web `endGameChest`）：基础 5%，本局得分 ≥800 再 +5%，
     * 连续 12 局未出则保底必出；命中后按 70/25/5 抽普通/稀有/史诗，并从该级奖励池随机取一份 token 礼包。
     * 状态（连续未出局数 / 累计宝箱数）落 Storage，保证保底跨局生效。
     */
    private rollChest(score: number): { tier: ChestTier; reward: ChestReward } | null {
        const st = Storage.getJSON<{ since?: number; total?: number }>(STORAGE_KEYS.chest, {});
        const since = (st.since ?? 0) + 1;
        let prob = 0.05;
        if (score >= 800) prob += 0.05;
        if (since >= 12) prob = 1;
        if (Math.random() > prob) {
            Storage.setJSON(STORAGE_KEYS.chest, { since, total: st.total ?? 0 });
            return null;
        }
        const tier = this.pickTier();
        const pool = CHEST_TIER_REWARDS[tier];
        const reward = { ...pool[Math.floor(Math.random() * pool.length)] };
        Storage.setJSON(STORAGE_KEYS.chest, { since: 0, total: (st.total ?? 0) + 1 });
        return { tier, reward };
    }

    private pickTier(): ChestTier {
        const r = Math.random() * 100;
        if (r < 70) return 'common';
        if (r < 95) return 'rare';
        return 'epic';
    }

    /**
     * 结算卡（严格对齐 web `.game-over-card`）：模式标题 + 鼓励语 + 大号得分 + 经验(+升级徽章) +
     * 「本局战报」深蓝子卡（消行/最高连击/命中率/用时）+ 主 CTA「再来一局」+ 弱化链接（菜单/回放/分享）。
     * 背景点按 = 再来一局（与 web「点击重开」一致），分享不关闭面板。
     */
    private showGameOverPanel(xpGain: number, leveledUp: boolean, level: number): void {
        const score = this.model.score;
        const newBest = score > this.prevBest && score > 0;
        // 鼓励语：无时限模式（经典/无尽）的「棋盘填满」收尾；限时模式不显示。
        const subtitle = this.model.modeDef.timeLimitSec <= 0 ? t('gameover.encourage') : null;
        const links: GameOverLink[] = [];
        if (this.onRequestMenu) {
            // 去主菜单前先把未展示的局末宝箱奖励静默入账，避免错失。
            links.push({ label: t('game.menu'), onClick: () => { this.flushPendingChest(); this.onRequestMenu!(); } });
        }
        // 回放 / 分享叠在结算卡之上打开，关闭后回到结算卡（keepOpen 不关本卡）。
        links.push({ label: t('game.actions.replay'), onClick: () => this.openReplays(), keepOpen: true });
        links.push({ label: t('btn.share'), onClick: () => this.doShare(), keepOpen: true });
        GameOverPanel.show(this.node, {
            title: t('gameover.title'),
            subtitle,
            score,
            xpText: xpGain > 0 ? t('gameover.xpGain', { n: xpGain }) : null,
            levelBadge: leveledUp ? `★ Lv.${level}` : null,
            newBest,
            digestTitle: t('game.summary.title'),
            facts: this.buildGameFacts(),
            againLabel: t('btn.again'),
            onAgain: () => this.restartFromGameOver(),
            links,
        });
    }

    /** 采集本局战报事实（对齐 web `progressDigest._collectFacts`）。 */
    private buildGameFacts(): GameOverFact[] {
        const g = this.game;
        const facts: GameOverFact[] = [
            { label: t('game.summary.clears'), value: t('game.summary.clearsValue', { n: g.clears }) },
            { label: t('game.summary.maxCombo'), value: `${g.maxCombo}` },
        ];
        const tries = g.placements + g.misses;
        if (tries > 0) {
            facts.push({ label: t('game.summary.hitRate'), value: `${Math.round((g.placements / tries) * 100)}%` });
        }
        if (g.startMs > 0) {
            const sec = Math.max(0, Math.floor((Date.now() - g.startMs) / 1000));
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            facts.push({ label: t('game.summary.duration'), value: `${m}:${String(s).padStart(2, '0')}` });
        }
        return facts;
    }

    /**
     * 把宝箱 token 礼包入账到钱包（严格对齐 web `_grantReward`）：
     *   · 各 token 走 `addBalance(kind, v*mult, 'chest-<tier>')`——宝箱来源已在 GRANT_BYPASS_SOURCES，免每日上限；
     *   · _trial 史诗箱：从（已存在的）试穿皮肤池随机取一个，发 12h 试穿券。
     * @returns 实际发到的试穿皮肤 id（无则空串）。
     */
    private grantChestReward(tier: ChestTier, reward: ChestReward, mult = 1): string {
        const wallet = this.model.wallet;
        const source = `chest-${tier}`;
        for (const [k, v] of Object.entries(reward)) {
            if (k.startsWith('_')) continue;
            wallet.addBalance(k as WalletKind, (v as number) * mult, source);
        }
        let trialSkin = '';
        if (reward._trial) {
            const owned = listSkinIds();
            const pool = CHEST_TRIAL_SKIN_POOL.filter((id) => owned.includes(id));
            if (pool.length) {
                trialSkin = pool[Math.floor(Math.random() * pool.length)];
                wallet.addTrial(trialSkin, 12);
            }
        }
        return trialSkin;
    }

    /** 把 token 礼包格式化为展示文案（对齐 web `_formatRewardDisplay`）。 */
    private formatChestReward(reward: ChestReward, trialSkin?: string, mult = 1): string {
        const map: Array<[WalletKind, string]> = [
            ['hintToken', 'chest.item.hint'], ['undoToken', 'chest.item.undo'],
            ['bombToken', 'chest.item.bomb'], ['rainbowToken', 'chest.item.rainbow'],
            ['freezeToken', 'chest.item.freeze'], ['previewToken', 'chest.item.preview'],
            ['rerollToken', 'chest.item.reroll'],
        ];
        const parts: string[] = [];
        for (const [kind, key] of map) {
            const n = (reward[kind] ?? 0) * mult;
            if (n > 0) parts.push(t(key, { n }));
        }
        if (reward._trial) {
            parts.push(trialSkin
                ? t('chest.item.trialNamed', { h: 12, name: getSkin(trialSkin).name })
                : t('chest.item.trial', { h: 12 }));
        }
        return parts.join(' · ');
    }

    /** 静默入账未展示的局末宝箱（玩家从结算卡直接去主菜单时，避免错失奖励）。 */
    private flushPendingChest(): void {
        const chest = this._pendingChest;
        if (!chest) return;
        this._pendingChest = null;
        this.grantChestReward(chest.tier, chest.reward);
        this.hud.setCoins(this.model.wallet.coins);
        this.skillBar.refresh();
    }

    /** 离开结算卡：开新局后，若本局命中了宝箱，则把宝箱弹到新一局之上（对齐 web 顺序）。 */
    private restartFromGameOver(): void {
        const chest = this._pendingChest;
        // 先清掉 pending，避免 startGame 失败时 chest 残留到下一轮。
        this._pendingChest = null;
        // 「再来一局」= web `start({ fromChain: true })`：runStreak +1，启用 runStreakStress 累积加压。
        // 必须在 startGame() 之前，因为 startGame → playerCtx.reset() 不会触碰 runStreak（刻意），
        // 此处显式 +1 才能让本轮 spawn 拿到正确值。
        this.playerCtx.incrementRunStreak();
        // startGame 包了 guard，失败也不会抛出来 —— 但即便失败，宝箱也应该展示给玩家（奖励不能漏发）。
        this.startGame(this.model.mode);
        if (!chest) return;
        // 用 scheduleOnce(0) 让新局首帧渲染完再弹宝箱，避免与新局 UI 重排争抢 sibling 顺序。
        this.scheduleOnce(() => {
            if (!this.node?.isValid) return;
            try { this.showChest(chest); }
            catch (err) { console.warn('[OpenBlock] restartFromGameOver showChest', err); }
        }, 0);
    }

    /** 分级宝箱卡（严格对齐 web `.chest-card`）：
     *  - bigValue 渲染 tier 图标（🎁/🎀/🏆）— 与 web `.chest-icon` 同款视觉重量
     *  - title 为「{级别}宝箱」纯标题
     *  - lines 为道具礼包文案（+N 提示券 · 1 炸弹 …）+ 通用关闭提示
     *  - 主按钮"领取到钱包"，按钮回调与背景关闭/空白点击都触发 grant（onClose 统一发奖）
     *  - 看广告翻倍：广告成功则 token 数量 ×2 发放
     *  - 兜底：ModalPanel 创建失败时直接 grant，避免奖励吞没。 */
    private showChest(chest: { tier: ChestTier; reward: ChestReward }): void {
        const icon = chest.tier === 'epic' ? '🏆' : chest.tier === 'rare' ? '🎀' : '🎁';
        let granted = false;
        const grant = (mult = 1): void => {
            if (granted) return;
            granted = true;
            this.grantChestReward(chest.tier, chest.reward, mult);
            // 立即同步 HUD 金币 + 技能栏道具余额。
            this.hud.setCoins(this.model.wallet.coins);
            this.skillBar.refresh();
            // 领取入账时强反馈：unlock 上扬音 + 中震动。展示时机的 unlock 音由 ModalPanel.show 调用前播放。
            AudioManager.sfxUnlock();
            Haptics.medium();
        };
        // 对齐 web `endGameChest.js:221`：宝箱展示时立即播 unlock 音（领取再播一次形成"开启+到手"双反馈）。
        AudioManager.sfxUnlock();
        Haptics.light();
        let modal: ModalPanel | null = null;
        const buttons: ModalButton[] = [{
            label: t('chest.claim'),
            primary: true,
            color: new Color(70, 130, 90, 255),
            // 按钮回调先入账（即使后续 close → onClose 已经被 granted 标记跳过，奖励也已到账）
            onClick: () => { grant(); },
        }];
        // 看广告翻倍：广告成功则 token ×2 发放并关闭；失败保持弹窗可常规领取。
        if (flag('rewards')) {
            buttons.unshift({
                label: t('chest.adDouble'),
                color: new Color(60, 90, 150, 255),
                close: false,
                onClick: () => {
                    if (granted) return false;
                    void Ads.rewarded(getConfig().adUnitIds.doubleChest || 'doubleChest').then((ok) => {
                        if (ok) { grant(2); if (modal?.isValid) modal.close(); }
                    });
                    return false; // 等待广告结果，先不关闭
                },
            });
        }
        try {
            modal = ModalPanel.show(this.node, {
                title: t(`chest.${chest.tier}`),
                bigValue: icon,
                lines: [this.formatChestReward(chest.reward), t('chest.hint')],
                dismissable: true,
                buttons,
                onClose: () => grant(),
            });
        } catch (err) {
            // 任意异常都不能吃掉奖励：直接发放并提示。
            console.warn('[OpenBlock] showChest fallback grant', err);
            grant();
            this.fx.floatText(this.formatChestReward(chest.reward), new Color(255, 220, 130, 255), 80);
        }
    }

    private todayKey(): string {
        return new Date().toISOString().slice(0, 10);
    }

    /** 创建屏上伙伴（默认隐藏 —— 对齐 web mobile companionStub 不渲染 UI 的行为）。
     *
     *  历史问题（v1.62.1 修）：Companion 之前默认显示在 HUD 左上 (-250, 62)，contentSize 120×120 + TapBus 命中域，
     *  与顶栏按钮行（buttonsY=518，最左按钮 X≈-308）在 36×38 px 区域重叠。TapBus 逆序命中导致
     *  「点 ☰/🎨 等顶栏按钮 → 命中 Companion → 打开 Companion 面板」—— 即用户报告的"HUD 区按钮无法点击"。
     *
     *  修复：触屏平台（iOS / Android / WeChat / web-mobile）默认不创建 Companion 节点；
     *  桌面（dev/preview）保留以便调试。后续如需 mobile 上展示伙伴，
     *  应放到独立"伙伴角落"位置且 contentSize 严格不与按钮行 AABB 相交。 */
    private setupCompanion(): void {
        // 触屏平台一律不创建 Companion，源头避免 TapBus 命中域冲突。
        if (sys.isMobile || sys.isNative) {
            this.companionView = null;
            return;
        }
        const n = new Node('Companion');
        n.parent = this.hud.node;
        n.setPosition(-250, 62, 0);
        const cv = n.addComponent(CompanionView);
        cv.setup(() => this.openCompanionPanel());
        cv.setSkin(this.model.skin.id, this.companion.level());
        this.companionView = cv;
        this.relayoutCompanion();
    }

    /** Bootstrap.relayout 调用：随可见宽决定 Companion 位置（仅桌面端生效；触屏端未创建节点直接返回）。 */
    relayoutCompanion(): void {
        const n = this.companionView?.node;
        if (!n) return;
        try {
            const w = view.getVisibleSize().width;
            n.active = w >= 600;
            const offset = Math.max(170, Math.min(280, Math.round(w * 0.35)));
            n.setPosition(-offset, 62, 0);
        } catch { /* ignore */ }
    }

    /** 伙伴面板（对齐 web companion 意图）：展示名字/等级/亲密度 + 每日喂食。 */
    private openCompanionPanel(): void {
        const c = getCompanion(this.model.skin.id);
        const lv = this.companion.level();
        const today = this.todayKey();
        const max = this.companion.xpToNext() === 0;
        const lines = [
            c.name,
            max ? t('companion.bondMax') : t('companion.bond', { cur: Math.round(this.companion.progress() * 100), max: 100 }),
        ];
        const fed = !this.companion.canFeed(today);
        ModalPanel.show(this.node, {
            title: `${c.icon} ${t('companion.title')} · ${t('companion.level', { n: lv })}`,
            lines,
            dismissable: true,
            buttons: [
                {
                    label: fed ? t('companion.fed') : t('companion.feed', { n: 20 }),
                    primary: !fed,
                    color: fed ? new Color(74, 80, 100, 255) : new Color(70, 130, 90, 255),
                    onClick: () => {
                        const before = this.companion.level();
                        const got = this.companion.feed(this.todayKey());
                        if (got <= 0) { AudioManager.sfxInvalid(); return false; }
                        AudioManager.sfxSkill();
                        this.companionView?.react();
                        if (this.companion.level() > before) {
                            this.fx.floatText(t('companion.levelup', { n: this.companion.level() }), new Color(255, 220, 130, 255));
                        }
                        this.companionView?.setSkin(this.model.skin.id, this.companion.level());
                        this.save();
                    },
                },
                { label: t('btn.close'), color: new Color(74, 80, 100, 255), onClick: () => { /* close */ } },
            ],
        });
    }

    openWheel(): void {
        if (!flag('wheel')) return;
        const cfg = getConfig();
        WheelPanel.show(this.node, {
            prizes: WHEEL_PRIZES,
            spin: () => spinWheel(),
            grant: (prize) => this.grantWheelPrize(prize),
            formatPrize: (prize, trialSkin) => this.formatWheelPrize(prize, trialSkin),
            adSpin: () => Ads.rewarded(cfg.adUnitIds.wheel || 'wheel'),
        });
    }

    /**
     * 把转盘奖品入账钱包（严格对齐 web `luckyWheel.js:_grant`）：
     *   · 各 token/金币走 `addBalance(kind, v, 'lucky-wheel-<id>')`——非豁免来源，受每日发放上限约束（与 web 一致）；
     *   · trialHours：从 WHEEL_TRIAL_POOL（限已拥有皮肤）随机取一个发限时试穿券。
     * @returns 实际发到的试穿皮肤 id（无则空串）。
     */
    private grantWheelPrize(prize: WheelPrize): string {
        const wallet = this.model.wallet;
        const source = `lucky-wheel-${prize.id}`;
        for (const [k, v] of Object.entries(prize.items)) {
            wallet.addBalance(k as WalletKind, v as number, source);
        }
        let trialSkin = '';
        if (prize.trialHours) {
            const owned = listSkinIds();
            const pool = WHEEL_TRIAL_POOL.filter((id) => owned.includes(id));
            if (pool.length) {
                trialSkin = pool[Math.floor(Math.random() * pool.length)];
                wallet.addTrial(trialSkin, prize.trialHours);
            }
        }
        // 立即同步 HUD 金币 + 技能栏道具余额。
        this.hud.setCoins(wallet.coins);
        this.skillBar.refresh();
        return trialSkin;
    }

    /** 把转盘奖品格式化为展示文案（对齐 web prize.label，含金币与试穿）。 */
    private formatWheelPrize(prize: WheelPrize, trialSkin?: string): string {
        const map: Array<[WalletKind, string]> = [
            ['hintToken', 'chest.item.hint'], ['undoToken', 'chest.item.undo'],
            ['bombToken', 'chest.item.bomb'], ['rainbowToken', 'chest.item.rainbow'],
            ['freezeToken', 'chest.item.freeze'], ['previewToken', 'chest.item.preview'],
            ['rerollToken', 'chest.item.reroll'], ['coin', 'chest.item.coin'],
        ];
        const parts: string[] = [];
        for (const [kind, key] of map) {
            const n = prize.items[kind] ?? 0;
            if (n > 0) parts.push(t(key, { n }));
        }
        if (prize.trialHours) {
            parts.push(trialSkin
                ? t('chest.item.trialNamed', { h: prize.trialHours, name: getSkin(trialSkin).name })
                : t('chest.item.trial', { h: prize.trialHours }));
        }
        return parts.join(' · ');
    }

    selectMode(): void {
        if (!flag('modes')) return;
        ModalPanel.show(this.node, {
            title: t('btn.mode'),
            buttons: MODE_ORDER.map((m) => ({
                label: `${t(getMode(m).nameKey)} · ${t(getMode(m).descKey)}`,
                // 当前模式高亮为主操作态，给玩家「你在哪」的定位。
                primary: m === this.model.mode,
                onClick: () => this.startGame(m),
            })),
            dismissable: true,
        });
    }

    /** 7 日签到日历（对齐 web `#checkin-panel`）：日历展示 + 领取今日奖励 + 月度里程碑。 */
    openCheckin(): void {
        CheckInPanel.show(this.node, {
            streak: this.meta.streak,
            nextDay: this.meta.nextStreakDay(),
            alreadyClaimed: !this.meta.canCheckin(),
            rewards: this.meta.rewardSchedule(),
            onClaim: () => {
                const res = this.meta.checkin();
                if (res) {
                    const trialSkin = grantCheckinReward(this.model.wallet, res.day, res.reward, listSkinIds());
                    if (res.reward.trialHours && trialSkin) {
                        this.fx.floatText(t('chest.item.trialNamed', { h: res.reward.trialHours, name: getSkin(trialSkin).name }), new Color(214, 180, 255, 255), 60);
                    }
                }
                if (this.daily) {
                    const dailyRes = this.daily.checkin();
                    this.recordSeasonEvent('streak_days', dailyRes.streak);
                    const milestone = this.daily.monthlyMilestone();
                    if (milestone > 0) {
                        this.model.wallet.earn(milestone);
                        // 月度里程碑达成（对齐 web monthlyMilestone celebrate toast，~4s）。
                        Toast.show({ text: t('toast.milestone', { n: milestone }), tier: 'celebrate', durationMs: 4000 });
                    }
                }
                // 同步 HUD 金币 + 技能栏道具余额。
                this.hud.setCoins(this.model.wallet.coins);
                this.skillBar.refresh();
                AudioManager.sfxUnlock();
                Haptics.medium();
                this.save();
            },
            onClose: () => this.metaPanel.refresh(),
        });
    }

    private recordSeasonEvent(type: SeasonTaskType, value = 1): void {
        const fresh = this.seasonPass.recordEvent(type, value);
        if (!fresh.length) return;
        this.showSeasonTaskToast(fresh);
        this.save();
    }

    private showSeasonTaskToast(tasks: SeasonTask[]): void {
        let y = 80;
        for (const task of tasks) {
            this.fx.floatText(t('season.taskDone', { label: task.label }), new Color(255, 210, 110, 255), y);
            this.fx.floatText(t('season.taskReward', { reward: task.reward }), new Color(245, 176, 32, 255), y - 44);
            y += 72;
        }
        AudioManager.sfxUnlock();
        Haptics.light();
    }

    /** 赛季通行证任务面板（对齐 web `#season-pass-panel`）：任务进度 + 积分 + 高级通行证入口。 */
    openSeasonPass(): void {
        if (!flag('seasonPass')) return;
        SeasonPassPanel.show(this.node, {
            pass: this.seasonPass,
            // 付费轨道未接入支付：给一次提示飘字（对齐 web「付费功能即将上线」）。
            onBuyPremium: () => this.fx.floatText(t('season.buyPremium'), new Color(214, 180, 255, 255), 60),
            onClose: () => this.metaPanel.refresh(),
        });
    }

    doShare(): void {
        if (!flag('share')) return;
        const result = Share.shareScore(this.model.best);
        const msg = result === 'shared'
            ? t('share.started')
            : result === 'copied'
                ? t('share.copied')
                : t('share.unavailable');
        this.fx.floatText(msg, result === 'unavailable'
            ? new Color(255, 170, 110, 255)
            : new Color(180, 230, 255, 255), 80);
        if (result === 'unavailable') {
            AudioManager.sfxInvalid();
            Haptics.light();
        } else {
            AudioManager.sfxTick();
            Haptics.light();
        }
    }

    showLeaderboard(): void {
        if (!flag('leaderboard')) return;
        const top = Leaderboard.top(10);
        LeaderboardPanel.show(this.node, { entries: top });
    }

    toggleSound(): boolean {
        const on = !AudioManager.enabled;
        AudioManager.setEnabled(on);
        if (on && flag('bgm')) AudioManager.startBgm();
        Storage.set(STORAGE_KEYS.sound, on ? '1' : '0');
        return on;
    }

    /** 切换震动反馈开关；落盘到 Storage，与 web `feedbackToggles` 行为对齐。 */
    toggleHaptics(): boolean {
        const on = !Haptics.enabled;
        Haptics.enabled = on;
        Storage.set(STORAGE_KEYS.haptics, on ? '1' : '0');
        // 立即一次反馈，让玩家感受"开/关"差别。
        if (on) Haptics.medium();
        return on;
    }

    private maybeWelcomeBack(onDone?: () => void): void {
        const last = Storage.getNumber(STORAGE_KEYS.lastSeen, 0);
        const now = Date.now();
        Storage.setNumber(STORAGE_KEYS.lastSeen, now);
        const first = Storage.get(STORAGE_KEYS.firstLaunch, null);
        if (!first) {
            Storage.set(STORAGE_KEYS.firstLaunch, String(now));
            // 首日礼包
            ModalPanel.show(this.node, {
                title: t('welcome.gift'),
                lines: ['🪙 50'],
                dismissable: true,
                buttons: [{ label: t('btn.claim'), primary: true, color: new Color(70, 130, 90, 255), onClick: () => this.model.wallet.earn(50) }],
                onClose: onDone,
            });
            return;
        }
        if (last > 0) {
            const days = Math.floor((now - last) / 86400000);
            if (days >= 1) {
                const gift = Math.min(200, 30 * days);
                ModalPanel.show(this.node, {
                    title: t('welcome.back', { n: days }),
                    lines: [`🪙 ${gift}`],
                    dismissable: true,
                    buttons: [{ label: t('btn.claim'), primary: true, color: new Color(70, 130, 90, 255), onClick: () => this.model.wallet.earn(gift) }],
                    onClose: onDone,
                });
                return;
            }
        }
        onDone?.();
    }

    private renderAll(): void {
        this.board.render(this.model.grid, this.model.skin);
        this.dock.render(this.model.dock, this.model.skin);
        this.hud.setScore(this.model.score);
        this.hud.setCoins(this.model.wallet.coins);
        this.hud.setGameOver(this.model.gameOver);
    }

    /**
     * 对齐 web `getCandidatePlacementSolutionSnapshot` + `_updateBottleneckTrough`：
     * 统计当前 dock 周期内「未放置候选块」的合法落点总数，以及其中最少合法落点数。
     * 该信号会进入 `adaptiveSpawn` 的 bottleneckRelief，帮助下一轮在玩家接近被困时减压。
     */
    private updateBottleneckTrough(): void {
        let solutionCount = 0;
        let firstMoveFreedom = Infinity;
        let sampled = 0;
        for (const b of this.model.dock) {
            if (!b || b.placed) continue;
            let count = 0;
            for (let y = 0; y < this.model.grid.size; y++) {
                for (let x = 0; x < this.model.grid.size; x++) {
                    if (this.model.grid.canPlace(b.shape, x, y)) count++;
                }
            }
            solutionCount += count;
            firstMoveFreedom = Math.min(firstMoveFreedom, count);
            sampled++;
        }
        if (sampled <= 0) return;
        this.playerCtx.updateBottleneck(solutionCount, firstMoveFreedom);
    }

    /** 盘面尺寸变化后由布局层调用：仅重绘盘面（位置/边长已由 Bootstrap 更新）。 */
    redrawBoard(): void {
        if (!this.board) return;
        this.board.render(this.model.grid, this.model.skin);
    }

    /** 候选区尺寸变化后由布局层调用。 */
    refreshDock(): void {
        if (!this.dock) return;
        this.dock.render(this.model.dock, this.model.skin);
    }

    // ---- skills ----

    /**
     * 对齐 web `hintEconomy.js:231-258 _drawHintOverlay`：3 秒脉动高亮（sin 调制 α），
     * 比静态 ghost 更醒目；过期后回到正常盘面渲染。期间被新拖拽/落子打断也会被 renderAll 覆盖。
     */
    private _hintPulseTimer: number = 0;
    private showHintPulse(shape: number[][], gx: number, gy: number, colorIdx: number): void {
        const totalMs = 2400;
        const startMs = Date.now();
        const tick = () => {
            if (!this.node?.isValid) return;
            const t = Date.now() - startMs;
            if (t >= totalMs) {
                // 收尾：仅清掉独立 ghost 层即可（脉冲期间盘面格未变，无需全量 render）。
                this.board.clearGhost();
                this._hintPulseTimer = 0;
                return;
            }
            // sin 调制：85→200→85；最后 600ms 线性收尾到 0，避免突然消失。
            const phase = Math.sin((t / totalMs) * Math.PI * 4);
            let alpha = Math.round(140 + 60 * phase);
            const tailMs = 600;
            if (t > totalMs - tailMs) alpha = Math.round(alpha * Math.max(0, (totalMs - t) / tailMs));
            // ⚡ renderGhost 仅作用于独立 Layer 6（自带 g.clear()），盘面 blocks/bg/grid 不变，
            //   不必每 0.08s 全量 board.render()（旧实现 30 次全盘重画）。
            this.board.renderGhost(this.model.grid, this.model.skin, shape, gx, gy, colorIdx, alpha);
            this._hintPulseTimer = (this._hintPulseTimer | 0) + 1;
            this.scheduleOnce(tick, 0.08);
        };
        tick();
    }

    private onSkill(id: SkillId): void {
        const def = SKILLS[id];
        if (this.model.gameOver) return;
        // 道具消费（对齐 web）：每次使用消耗 1 个对应通货；余额含当日免费配额（hint/undo）。
        // aim 无 tokenKind（免费本地开关）。
        const kind = def.tokenKind;
        if (kind && this.model.wallet.getBalance(kind) <= 0) {
            AudioManager.sfxInvalid();
            // 与 web 行为对齐：给一个明确的"道具不足"飘字，避免点击毫无反馈。
            this.fx.floatText(t('skill.needToken'), new Color(255, 180, 120, 255), -160);
            return;
        }
        // 消耗 1 个道具（仅在动作真正生效后扣减；失败分支直接 return 不扣）。
        const consume = (): void => { if (kind) this.model.wallet.spendKind(kind, 1, `skill-${id}`); };
        AudioManager.sfxSkill();
        switch (id) {
            case 'hint': {
                const hint = findHint(this.model.grid, this.model.dock);
                if (!hint) { AudioManager.sfxInvalid(); return; }
                consume();
                // 对齐 web hintEconomy.js:167：hint 应用成功额外播一次 tick，与 sfxSkill 形成"扣费+提示"双反馈。
                AudioManager.sfxTick();
                const b = this.model.dock[hint.index];
                this.board.render(this.model.grid, this.model.skin);
                this.showHintPulse(b.shape, hint.gx, hint.gy, b.colorIdx);
                break;
            }
            case 'undo': {
                if (this.model.undo()) {
                    consume();
                    this.renderAll();
                    // 撤销改变盘面状态，给回放一帧 snapshot，避免后续 place 在错误状态上回放。
                    this.replay.recordSnapshot(this.model.grid.cells);
                } else {
                    AudioManager.sfxInvalid();
                }
                break;
            }
            case 'bomb': {
                // 炸弹需点选目标：此处只切换待引爆态，命中盘面后再扣道具（见 onBoardTap）。
                this.pendingSkill = this.pendingSkill === 'bomb' ? null : 'bomb';
                this.skillBar.setActive(this.pendingSkill);
                if (this.pendingSkill) this.fx.floatText(t('skill.bombHint'), new Color(255, 160, 120, 255), -120);
                break;
            }
            case 'rainbow': {
                const n = this.model.rainbowClear();
                if (n > 0) {
                    consume();
                    this.renderAll();
                    this.replay.recordSnapshot(this.model.grid.cells);
                } else {
                    AudioManager.sfxInvalid();
                }
                break;
            }
            case 'freeze': {
                consume();
                this.model.setFreeze(true);
                break;
            }
            case 'reroll': {
                consume();
                this.model.reroll();
                this.renderAll();
                break;
            }
            case 'preview': {
                const spots = listBestPlacements(this.model.grid, this.model.dock);
                if (spots.length === 0) { AudioManager.sfxInvalid(); return; }
                consume();
                for (const s of spots) {
                    const b = this.model.dock[s.index];
                    if (b) this.fx.flashPlacement(b.shape, s.gx, s.gy, blockColor(this.model.skin, b.colorIdx));
                }
                break;
            }
            case 'aim': {
                this.aimAssist = !this.aimAssist;
                this.skillBar.setActive(this.aimAssist ? 'aim' : null);
                this.fx.floatText(this.aimAssist ? '🎯' : '·', new Color(180, 255, 180, 255), -150);
                break;
            }
            default:
                break;
        }
        this.skillBar.refresh();
    }

    // ---- input ----

    /** 供 Bootstrap 在 start 阶段兜底转发触摸（确保场景就绪后 TapBus 可响应）。 */
    dispatchTap(e: EventTouch): boolean {
        // 整体 try/catch：原生 JSB 端任何 UITransform.hitTest / onTap 内的 native 异常
        // 都会被引擎记为 `Invoking function failed` 并在每次后续 touch-end 上重放 →
        // UI 假死 + logcat 刷屏。安卓系统下拉通知中心截断 touch 序列时偶发触发。
        try {
            const ui = e.getUILocation();
            const loc = e.getLocation();
            const hit = TapBus.hit(loc.x, loc.y, ui.x, ui.y);
            if (hit) console.log(`[OpenBlock] tap ok ui=(${ui.x | 0},${ui.y | 0})`);
            return hit;
        } catch (err) {
            console.error('[OpenBlock] dispatchTap threw; contained', err);
            return false;
        }
    }

    /** onTouchStart 累计调用次数；用于排查"input 是否真的进入了我们的 handler"。 */
    private _touchStartCount = 0;

    private onTouchStart(e: EventTouch): void {
        // 任何触摸都顶到高帧：拖拽跟手、按钮反馈都需要 60fps（空闲窗口过后自动回落 30fps）。
        FrameRate.poke();
        const loc = e.getLocation();
        this._touchStartCount++;
        // 入口探针：只要 input 监听器注册成功且事件分发到位，这条就会打。
        // 如果你点 dock 候选块却完全看不到这条日志，那就是 onEnable 里的 input.on(TOUCH_START)
        // 在你的 build 上没生效（可能 GameController.onEnable 没跑、或被另一个 listener 吞了事件）。
        console.log(`[OpenBlock] touch-start#${this._touchStartCount} at (${loc.x | 0},${loc.y | 0}) dragIdx=${this.dragIndex} tapSel=${this._tapSelected ? 1 : 0} modal=${Modal.isOpen() ? 1 : 0} meta=${this.metaPanel?.node?.active ? 1 : 0} over=${this.model.gameOver ? 1 : 0}`);

        // ⭐ tap-to-select 第二次触摸路由（必须在僵尸自愈之前判定，否则会先把选中态 cancel 掉）。
        // 关键设计：本次 touch-start 不立即执行 PLACE/DESELECT，而是进入「待定 tap-or-drag」窗口 ——
        //   * 手指不动松手 → onTouchEnd 执行待定动作（落子 / 取消选中）
        //   * 手指移动     → onTouchMove 把 dragMoved 翻 true，待定动作自动作废，无缝升级为正常 drag
        // 这是修复「选中候选块后无法左右拖动」的核心：之前在 START 就立即落子/取消，move 路径永远不跑。
        if (this._tapSelected && this.dragIndex >= 0) {
            const consumed = this.beginTapSelectedSecondTouch(e, loc);
            if (consumed) return;
            // 未消费 → 当前 tap 落在 HUD/skillBar/空白：取消选中，继续走正常 onTouchStart 流程
            // （在 onTouchEnd 阶段由 TapBus 分发到具体按钮）。
            this.cancelDrag();
        }

        // ⭐ 僵尸 drag 自愈（v1.62.1 强化版）：
        // 现实中 TOUCH_START 在 drag 进行中触发 = 上一次触摸序列已经结束（END/CANCEL 被吞或 touchId 被回收）。
        // 规则：dragIndex>=0 时一律 cancel，不再做 "foreign vs same id" 判定。
        // 理由：iOS UITouch.identifier 在某些场景被复用（手指快速抬起再按 / WebView 介入 / 横竖屏切换），
        // 之前的 "foreign-only" 规则在 id 复用时会漏掉同 id 的僵尸态 → 用户报告的「玩几步就无法激活候选块」就是这种 case。
        // 多指代价：用户用第二根手指点屏幕会中断第一指的 drag —— 对单指为主的休闲玩法可接受。
        if (this.dragIndex >= 0) {
            const age = this.dragStartedAtMs ? Date.now() - this.dragStartedAtMs : -1;
            console.warn(`[OpenBlock] heal stale drag idx=${this.dragIndex} touchId=${this.dragTouchId} age=${age}ms`);
            this.cancelDrag();
        }
        // 泄漏守卫兜底：连续点击死区却被 Modal/metaPanel 拦住且无合法弹窗 → 主动恢复（见方法注释）。
        // 放在各守卫 return 之前：恢复成功后本次 onTouchStart 会继续走到 pickBlock，立即激活。
        this.maybeRecoverLeakedGuard(loc, e);
        // 模态打开（主菜单/弹窗）：只在 END 阶段分发 TapBus（与 web `click` 语义对齐，避免 START+END 双触发）。
        if (Modal.isOpen()) {
            this.maybeHealGhostModal();
            // 自愈成功后立刻继续走 pick；失败仍按原语义拦截。
            if (Modal.isOpen()) {
                console.log(`[OpenBlock] touch-blocked: Modal.isOpen at (${loc.x | 0},${loc.y | 0})`);
                return;
            }
        } else {
            this._modalBlockSinceMs = 0;
        }
        // MetaPanel 自己用 blocker 拦点，业务输入直接屏蔽。
        if (this.metaPanel.node.active) {
            console.log(`[OpenBlock] touch-blocked: MetaPanel.active at (${loc.x | 0},${loc.y | 0})`);
            return;
        }
        // GameOver 时不再 fallback 直接重开 —— 仅结算卡 CTA 重开（避免点 HUD/盘面空白处误开新局）。
        if (this.model.gameOver) {
            console.log(`[OpenBlock] touch-blocked: gameOver at (${loc.x | 0},${loc.y | 0})`);
            return;
        }

        // 炸弹待引爆：点击盘面
        if (this.pendingSkill === 'bomb') {
            console.log(`[OpenBlock] touch-routed: bomb at (${loc.x | 0},${loc.y | 0})`);
            const bl = screenToLocal(this.board.node, loc.x, loc.y);
            const cell = this.board.localToCell(bl.x, bl.y);
            this.pendingSkill = null;
            this.skillBar.setActive(null);
            if (cell) {
                const n = this.model.bombArea(cell.gx, cell.gy, 1);
                if (n > 0) {
                    if (SKILLS.bomb.tokenKind) this.model.wallet.spendKind(SKILLS.bomb.tokenKind, 1, 'skill-bomb');
                    this.renderAll();
                    this.replay.recordSnapshot(this.model.grid.cells);
                } else {
                    AudioManager.sfxInvalid();
                }
            }
            this.skillBar.refresh();
            return;
        }

        // 全局 input 兜底：与槽位 touchstart 同逻辑（web shape 格命中，非整槽矩形）。
        const pick = this.dock.pickBlock(loc.x, loc.y);
        if (pick >= 0) {
            this.beginDockDrag(pick, e);
            return;
        }
        // 未命中候选块——可能是空白区/菜单按钮/盘面/skillBar 等，由 onTouchEnd 走 TapBus 分发。
        // 加日志确认 touch 确实进了入口；如果你点候选块却完全看不到本条日志，说明 input 监听根本没注册成功。
        console.log(`[OpenBlock] touch-start nopick at (${loc.x | 0},${loc.y | 0}) dockPickResult=${pick}`);
        // 注意：菜单/按钮命中的 TapBus 分发改在 onTouchEnd 完成（START 不再 dispatchTap）。
        this.diagnoseMissedDockTap(loc.x, loc.y);
    }

    /**
     * 触摸落在 dock 区视觉范围内但 pickBlock 返回 -1 → 屏出诊断信息（一次性，节流）。
     * 这是"候选块激活失败"的最常见误诊：玩家点的是空白槽（已 placed 的槽 → 不可激活），
     * 或者点在 shape cell 之间的空白格上（与 web 同源行为，但视觉上不易察觉）。
     * 仅 sys.isNative 启 console.warn 帮 Xcode 排查；浏览器/小游戏端不刷屏。
     */
    private _lastMissDiagMs = 0;
    private diagnoseMissedDockTap(sx: number, sy: number): void {
        const now = Date.now();
        if (now - this._lastMissDiagMs < 800) return; // 节流
        const dn = this.dock.node;
        const uit = dn.getComponent(UITransform);
        if (!uit) return;
        const local = screenToLocal(dn, sx, sy);
        const hw = uit.contentSize.width / 2;
        const hh = uit.contentSize.height / 2;
        if (Math.abs(local.x) > hw || Math.abs(local.y) > hh) return;
        this._lastMissDiagMs = now;
        const placedFlags = this.model.dock.map((b) => (b?.placed ? '1' : '0')).join('');
        // 多打 shape / 槽 0/1/2 命中域，便于未来精确定位哪一槽被点漏。
        const slotsCenter = [this.dock.slotCenterX(0), this.dock.slotCenterX(1), this.dock.slotCenterX(2)].map((v) => v | 0).join(',');
        const slotPx = this.dock.slotPx | 0;
        console.warn(`[OpenBlock] dock-miss sx=${sx | 0} sy=${sy | 0} local=(${local.x | 0},${local.y | 0}) placed=${placedFlags} slotCenters=${slotsCenter} slotPx=${slotPx}`);
    }

    /**
     * Modal 计数泄漏自愈：onTouchStart 被 Modal.isOpen 拦截但场景实际上没有任何 modal 节点
     * 持续超过 MODAL_GHOST_HEAL_MS → 视为计数偏移（双 close 扣减、build 失败、tween 中断 …），
     * 强制 Modal.reset 让玩家恢复交互。
     *
     * 检测方式：遍历 this.node 的直接子节点，找名为 'Modal'|'GameOver'|'MainMenu'|'SkinPanel'|'Wheel'|
     * 'SeasonPassPanel'|'CheckInPanel'|'ReplayPanel'|'ReplayViewer'|'LorePanel'|'Tutorial'|'SkinTransition'
     * 的活跃节点 —— 任一存在即视为合法 modal，不自愈。MetaPanel 用 blocker 拦截，单独走 metaPanel.node.active 判定。
     */
    private maybeHealGhostModal(): void {
        const has = this.hasAnyModalLikeChild();
        if (has) {
            this._modalBlockSinceMs = 0;
            return;
        }
        const now = Date.now();
        if (this._modalBlockSinceMs === 0) {
            this._modalBlockSinceMs = now;
            return;
        }
        if (now - this._modalBlockSinceMs < MODAL_GHOST_HEAL_MS) return;
        const elapsed = now - this._modalBlockSinceMs;
        console.warn(`[OpenBlock] ghost-modal heal: Modal._count leaked, no panel for ${elapsed}ms → reset`);
        Modal.reset();
        this._modalBlockSinceMs = 0;
    }

    /**
     * 泄漏守卫兜底恢复（iOS「操作几次后无法激活候选块」的通用解）：
     *
     * 适用态：onTouchStart 被 `Modal.isOpen()` 或 `metaPanel.node.active` 拦住，但场景里其实
     * 没有任何合法弹窗在显示 —— 即 Modal 计数泄漏（弹窗 close 竞态 / iOS 边缘手势吞 END）或
     * metaPanel.active 卡死。这类「有守卫、无 UI」的态会让所有触摸被早退拦死、又无处可点恢复。
     *
     * 误伤防护（关键）：只在「这次点击没命中任何可交互目标（TapBus.probe=false）」时计数。
     * 合法弹窗一定铺了全屏遮罩/按钮（都是 TapBus 目标），玩家点它们必然 probe=true → 不计数、不恢复；
     * 唯有点在真正死区且仍被拦，才累计。连续 DEAD_TAP_RECOVER_COUNT 次（DEAD_TAP_WINDOW_MS 时窗内）
     * → 判定僵尸守卫态，Modal.reset + 收起卡死的 metaPanel + cancelDrag，使本次 onTouchStart 继续走到
     * pickBlock 立即激活候选块。
     *
     * gameOver 不在此列：它由 gameOverHealTick 重新弹结算卡，绝不能在这里 reset 后放行落子。
     */
    private maybeRecoverLeakedGuard(loc: { x: number; y: number }, e: EventTouch): void {
        const modalLeak = Modal.isOpen() && !this.hasAnyModalLikeChild();
        const metaStuck = this.metaPanel?.node?.active === true;
        if (!modalLeak && !metaStuck) { this._deadBlockedTaps = 0; return; }
        // 命中任何可交互目标（弹窗按钮 / 遮罩吸收层）= 合法交互，立即清零、不恢复。
        let hitInteractive = false;
        try {
            const ui = e.getUILocation();
            hitInteractive = TapBus.probe(loc.x, loc.y, ui.x, ui.y);
        } catch { /* probe 失败按「未命中」保守处理，仍需累计才恢复，不会单次误触 */ }
        if (hitInteractive) { this._deadBlockedTaps = 0; return; }
        const now = Date.now();
        if (now - this._firstDeadBlockedTapMs > DEAD_TAP_WINDOW_MS) {
            this._deadBlockedTaps = 0;
            this._firstDeadBlockedTapMs = now;
        }
        this._deadBlockedTaps++;
        if (this._deadBlockedTaps < DEAD_TAP_RECOVER_COUNT) return;
        this._deadBlockedTaps = 0;
        console.warn(`[OpenBlock] leaked-guard recover: modalLeak=${modalLeak} metaStuck=${metaStuck} modalCount→reset`);
        if (modalLeak) { try { Modal.reset(); } catch { /* ignore */ } }
        if (metaStuck) { try { this.metaPanel.hide(); } catch { /* ignore */ } }
        try { if (this.dragIndex >= 0) this.cancelDrag(); } catch { /* ignore */ }
        this._tapSelected = false;
        this._pendingTapAction = null;
    }

    private hasAnyModalLikeChild(): boolean {
        // ⚠️ 必须与各面板 show() 里 new Node('<name>') 的根节点名严格一致，否则自愈会把
        // 该面板误判为「无 modal」→ 提前 Modal.reset()。WheelPanel 根节点名是 'Wheel'（非 'WheelPanel'），
        // SeasonPassPanel / CheckInPanel 此前漏登记。MetaPanel 走 metaPanel.node.active 单独把关，不在此列。
        const names = new Set(['Modal', 'GameOver', 'MainMenu', 'SkinPanel', 'Wheel', 'SeasonPassPanel', 'CheckInPanel', 'ReplayPanel', 'ReplayViewer', 'LorePanel', 'Tutorial', 'SkinTransition', 'MetaPanelOverlay']);
        for (const ch of this.node.children) {
            if (ch?.activeInHierarchy && names.has(ch.name)) return true;
        }
        // MetaPanel 也会 Modal.open()，但它走 metaPanel.node.active 单独把关、根节点不在上表 ——
        // 这里把「metaPanel 活跃」一并视为合法 modal，避免 Modal 被误判为泄漏而提前 reset。
        if (this.metaPanel?.node?.active === true) return true;
        return false;
    }

    /**
     * 从候选区起手拖拽（对齐 web `startDrag`）。
     * 由 DockView 槽位 touchstart 或全局 pickBlock 触发。
     *
     * 注：onTouchStart 已统一做僵尸 drag 自愈（不同 touchId 的新 START 会先 cancelDrag），
     * 这里仍保留 dragIndex>=0 守卫，仅拦截"同一手指 在 START 内被重复触发"的边角，
     * 避免与正常进行中的同一手指拖拽冲突。
     */
    /**
     * 把 ghost 节点恢复到"可立即使用"的中性态：停掉所有遗留 tween（reject shake 的位置/透明度
     * 渐变、上次拖拽的位移动画），UIOpacity 强制 255，位置归零。
     *
     * 必须在 drawGhost / placeGhostAtTouch 之前调用 —— 否则 reject 抖动还在跑时玩家激活的新候选块
     * 会立刻被旧 tween 拽回原点 + 淡出，表现为"候选块无法二次激活"。
     */
    private prepareGhost(): void {
        try { Tween.stopAllByTarget(this.ghost); } catch { /* ignore */ }
        const op = this.ghost.getComponent(UIOpacity);
        if (op) {
            try { Tween.stopAllByTarget(op); } catch { /* ignore */ }
            op.opacity = 255;
        }
        // 把 scale 也复位到 1.0，避免上一次激活弹出动画被中断后残留 0.7/1.05 等中间值，
        // 表现为"新一次激活时 ghost 偏小或偏大"。
        this.ghost.setScale(1, 1, 1);
        this.ghost.setPosition(0, 0, 0);
    }

    /**
     * 激活那一刻给 ghost 一个 0.6→1.0 的弹出动画（backOut，POP_GHOST_DURATION_S）——
     * 视觉上明确传达"我已经把候选块从 dock 抓起来了"，并让玩家一眼分辨
     * "盘面落点预览（faded alpha=140）"与"指尖跟手 ghost（solid + pop scale）"。
     * 时长对齐主流休闲块拼图（Block Blast / Royal Match 约 60-80ms）—— 太长会让用户感觉
     * 「方块还在 settling，不能立刻拖」，从而误判为"响应慢"。
     *
     * 关键：整段必须对运行时异常完全免疫。曾经因为 `tween()` 工厂在 iOS native bundle 某些版本
     * 中出错，抛出后会让 beginDockDrag 后续的 `dock.setDraggingSlot(index)` 永远跑不到 ——
     * 表现为"dock 仍画完整候选块 + ghost 完全不可见"。
     * 兜底：异常时强制把 scale 复位到 1.0 让 ghost 仍可见，丢失的只是 70ms 弹出动效。
     */
    private popGhostOnActivate(): void {
        try {
            /* 严格对齐 web 主端：拖拽 ghost 直接以盘面 cell 尺寸出现，不做容器级
             * 0.6→1.0 缩放。iOS 原生 emoji Label 的 glyph 纹理异步烘焙时，容器缩放会让
             * Graphics 方块先变大、emoji 仍停留旧纹理，造成“emoji 没跟着方块放大”。
             * 当前 drawGhost 已每次重建 emoji Label，配合无缩放激活，确保方块面与 emoji 同尺寸稳态显示。 */
            this.ghost.setScale(1, 1, 1);
        } catch (err) {
            console.warn('[OpenBlock] popGhost setup fail, fallback no-anim', err);
            try { this.ghost.setScale(1, 1, 1); } catch { /* ignore */ }
        }
    }

    /**
     * tap-to-select 选中态的持续视觉反馈：UIOpacity 在 220↔255 之间循环 0.9s 一个周期，
     * 让玩家清晰感知"这个候选块已选中、悬浮等待落子"。脉动 token 用代际隔离避免下次激活时残留。
     */
    private startSelectedPulse(): void {
        try {
            const op = this.ghost.getComponent(UIOpacity);
            if (!op) return;
            Tween.stopAllByTarget(op);
            op.opacity = 255;
            const inner = tween(op).to(0.45, { opacity: 200 }).to(0.45, { opacity: 255 });
            tween(op).repeatForever(inner).start();
        } catch (err) {
            console.warn('[OpenBlock] startSelectedPulse fail', err);
        }
    }

    /**
     * tap-to-select 第二次触摸的「待定动作」入口（不立即执行 PLACE/DESELECT）：
     *
     * 路由：
     *  - 点不同候选槽 → 立即 SWITCH（重新 beginDockDrag）。这一步不能延迟，否则用户点新块期望"立即激活新块"会失败。
     *  - 点同一候选槽 → 进入 deferred 模式，pending='deselect'：松手即取消；移动即转 drag。
     *  - 点板面格    → 进入 deferred 模式，pending='place'：松手即尝试落子；移动即转 drag。
     *  - 其他（HUD/空白）→ 返回 false，由调用方走 TapBus 分发。
     *
     * deferred 模式的关键状态：
     *  - this._tapSelected = false（退出"已选中"语义，进入"按下中"）
     *  - this.dragIndex 保留（让 onTouchMove 能继续驱动）
     *  - this.dragStartScreenX/Y = 当前 touch（让 dragMoved 阈值从此点开始算）
     *  - this.dragOriginX/Y     = 当前 touch（让 ghost 立即 1:1 跟手）
     *  - this._pendingTapAction = 'place' 或 'deselect'（onTouchEnd 据此执行延迟动作）
     *
     * 返回 true 表示本次 touch-start 已被 tap-select 路径处理（包括 SWITCH 与 deferred 入场）。
     */
    private beginTapSelectedSecondTouch(e: EventTouch, loc: { x: number; y: number }): boolean {
        if (Modal.isOpen() || this.metaPanel?.node?.active || this.model.gameOver) {
            this.cancelDrag();
            return false;
        }
        const idx = this.dragIndex;
        const newPick = this.dock.pickBlock(loc.x, loc.y);
        if (newPick >= 0 && newPick !== idx) {
            console.log(`[OpenBlock] tap-select SWITCH from=${idx} to=${newPick}`);
            this.cancelDrag();
            this.beginDockDrag(newPick, e);
            return true;
        }
        const aimLoc = this.dragControlScreenPoint(loc.x, loc.y);
        const bl = screenToLocal(this.board.node, aimLoc.x, aimLoc.y);
        const onBoardCell = !!this.board.localToCell(bl.x, bl.y);
        if (newPick !== idx && !onBoardCell) {
            // 点在 HUD / 空白：交还给上层 cancelDrag + TapBus。
            return false;
        }

        // 进入 deferred tap-or-drag 模式
        this._pendingTapAction = (newPick === idx) ? 'deselect' : 'place';
        this._tapSelected = false;
        this.dragStartScreenX = loc.x;
        this.dragStartScreenY = loc.y;
        this._lastTouchScreenX = loc.x;
        this._lastTouchScreenY = loc.y;
        this.dragMoved = false;
        this._liftFactor = 0;
        this._dragMovedAtMs = 0;
        try { this.dragTouchId = e.getID(); } catch { this.dragTouchId = null; }
        this.dragStartedAtMs = Date.now();
        this.dragLastSeenAtMs = this.dragStartedAtMs;
        // 停掉 select 脉动（不停的话 opacity tween 会持续生效让方块闪烁）。
        try {
            const op = this.ghost.getComponent(UIOpacity);
            if (op) { Tween.stopAllByTarget(op); op.opacity = 255; }
        } catch { /* ignore */ }
        // 把 ghost 锚到指尖（dragOrigin 同步更新）—— 让 moveGhost 与 onTouchEnd 的位置都基于指尖算。
        //   * 同槽 deselect：指尖在槽中心附近，ghost 几乎不动。
        //   * 板面 place：ghost 立即跳到指尖位置，玩家感受"块跟到手指上来了"，符合 tap-to-place 直觉。
        try { this.placeGhostAtTouch(loc); } catch { /* ignore */ }
        console.log(`[OpenBlock] tap-select PRESS idx=${idx} pending=${this._pendingTapAction} (newPick=${newPick}, onBoard=${onBoardCell})`);
        return true;
    }

    /**
     * deferred 'place' 动作执行体（由 onTouchEnd 调用）：
     * 用 release 参数算 snap → 能落则落；不能落则立即放回候选区，避免 ghost 停在非法盘面位置。
     */
    private tryTapPlaceAtTouch(e: EventTouch): void {
        const idx = this.dragIndex;
        this.updateSnap(e, true);
        const snap = this.snap;
        const canPlace = !!snap && this.model.canPlaceBlock(idx, snap.gx, snap.gy);
        if (canPlace && snap) {
            console.log(`[OpenBlock] tap-place PLACE idx=${idx} at grid=(${snap.gx},${snap.gy})`);
            this.cancelDrag();
            this.model.placeAt(idx, snap.gx, snap.gy);
            try { this.board.render(this.model.grid, this.model.skin); } catch { /* ignore */ }
            try { this.dock.render(this.model.dock, this.model.skin); } catch { /* ignore */ }
            return;
        }
        console.log(`[OpenBlock] tap-place INVALID idx=${idx} → return dock`);
        try { this.profile?.recordMiss?.(); } catch { /* ignore */ }
        this.cancelDrag();
        try { AudioManager.sfxInvalid(); } catch { /* ignore */ }
        try { Haptics.light(); } catch { /* ignore */ }
    }

    private beginDockDrag(index: number, e: EventTouch): void {
        if (this.dragIndex >= 0) return;
        if (Modal.isOpen() || this.metaPanel.node.active || this.model.gameOver) return;
        const block = this.model.dock[index];
        if (!block || block.placed) return;
        try { this.profile?.recordPickup?.(); } catch { /* ignore */ }

        const loc = e.getLocation();
        this.dragStartScreenX = loc.x;
        this.dragStartScreenY = loc.y;
        this._lastTouchScreenX = loc.x;
        this._lastTouchScreenY = loc.y;
        this.dragMoved = false;
        this.dragIndex = index;
        this.dragShape = block.shape;
        this.dragColor = block.colorIdx;
        this.snap = null;
        // lift 时间渐进：dragMoved 翻 true 才会启动；此处只清零，避免上一次拖拽残留。
        this._liftFactor = 0;
        this._dragMovedAtMs = 0;
        try { this.dragTouchId = e.getID(); } catch { this.dragTouchId = null; }
        this.dragStartedAtMs = Date.now();
        this.dragLastSeenAtMs = this.dragStartedAtMs;
        // 生命代际 +1：任何前一次拖拽的"延迟清理"回调（reject shake / pending fade）拿到的是旧 gen，
        // 命中本次 gen 校验后会自动跳过，从而不会清掉刚 drawGhost 的新画面。
        this._ghostGen++;

        // ---------------------------------------------------------------
        // CRITICAL PATH：以下三步是"激活成立"的最小必要集，必须 100% 跑完：
        //   1) prepareGhost：清掉残留 tween / 复位 UIOpacity / 位置归零
        //   2) drawGhost：在 ghost 节点画出板面 cell 尺寸的实体块
        //   3) dock.setDraggingSlot：让 dock 槽位腾空（"块已被取到指尖"）
        // 各步独立 try/catch，任何一步抛错都不阻塞后续——曾经因为 cosmetic 动画抛异常导致
        // setDraggingSlot 没机会跑，表现为"dock 仍画完整候选块 + ghost 完全不可见"。
        // ---------------------------------------------------------------
        try { this.prepareGhost(); } catch (err) { console.warn('[OpenBlock] beginDockDrag prepareGhost', err); }
        try { this.drawGhost(); } catch (err) { console.warn('[OpenBlock] beginDockDrag drawGhost', err); }
        try { this.dock.setDraggingSlot(index); } catch (err) { console.warn('[OpenBlock] beginDockDrag setDraggingSlot', err); }

        // ---------------------------------------------------------------
        // 装饰路径：位置 / 层级 / 弹出动画 / snap 预览。失败仅影响视觉，不影响 drag 可用性。
        // ---------------------------------------------------------------
        // ⭐ 激活瞬间 ghost 钉在「指尖位置 + 0 lift」。
        // 用户拖动时 ghost = touch delta × track + lift*ramp，snap 按同样公式算，两者完全重合，永远只显示一个方块。
        // tap-release 时 ghost 留在指尖位置，由 onTouchEnd 的 tap-select 分支再钉到 dock 槽中心。
        // 之前用 placeGhostAtDockSlot 锚到槽中心导致「dragOrigin 与初始触点错开 N 像素」→ 拖动时 ghost
        // 滞后手指相同的 N 像素 → 表现为「候选区边缘一个块 + 棋盘 snap 预览一个块」的双重渲染。
        try { this.placeGhostAtTouch(loc); } catch (err) { console.warn('[OpenBlock] beginDockDrag placeAtTouch', err); }
        try { this.ghost.setSiblingIndex(this.node.children.length - 1); } catch (err) { console.warn('[OpenBlock] beginDockDrag siblingIdx', err); }
        this.popGhostOnActivate(); // 自带 try/catch
        // ⭐ 关键：不在激活瞬间 updateSnap —— 否则会用 touch+lift 在板面"凭空"画出一个落点预览
        // （表现为「点 dock 后盘面上部出现候选块」）。只有 onTouchMove 跨过位移阈值后才计算 snap。
        this.snap = null;

        // 永远打一行确认日志，确保 Xcode console 里能定位"激活到底有没有发生"。
        // 之前 DEBUG_TOUCH=false 时静默，遇到 dock-stays-full 这种 bug 无法在不重 build 的情况下确诊。
        console.log(`[OpenBlock] dock activate slot=${index} ghostScale=(${this.ghost.scale.x.toFixed(2)},${this.ghost.scale.y.toFixed(2)}) at touch=(${loc.x.toFixed(1)},${loc.y.toFixed(1)})`);
    }

    /** 拖拽期被「模态打开/重排/换肤」中断时由外部调用，安全归零。 */
    cancelActiveDrag(): void {
        if (this.dragIndex < 0) return;
        this.cancelDrag();
    }

    /** Storage 写失败时由 Bootstrap 的 hook 调用，给玩家一次飘字提示（节流由 Storage 层完成）。 */
    notifyStorageFailure(): void {
        try { this.fx?.floatText(t('storage.failed'), new Color(255, 170, 110, 255), -120); } catch { /* ignore */ }
    }

    private isOwnTouch(e: EventTouch): boolean {
        if (this.dragTouchId == null) return true;
        try { return e.getID() === this.dragTouchId; } catch { return true; }
    }

    private shouldAbortDragNow(): boolean {
        // 拖拽中模态/MetaPanel/GameOver 被触发：立即取消，避免穿透落子。
        return Modal.isOpen() || (this.metaPanel?.node?.active === true) || this.model.gameOver;
    }

    private onTouchMove(e: EventTouch): void {
        if (this.dragIndex < 0) return;
        if (!this.isOwnTouch(e)) return;
        if (this.shouldAbortDragNow()) { this.cancelDrag(); return; }
        // 拖拽全程维持 60fps 跟手（poke 窗口短，靠 move 持续续期）。
        FrameRate.poke();
        this.dragLastSeenAtMs = Date.now();
        this.moveGhost(e);
        // 起手即视为「跟手位移」：updateSnap 用真实指位 + lift 计算落点（与 web 一致）。
        this.updateSnap(e);
    }

    /**
     * TOUCH_CANCEL —— 由 iOS app 切后台、系统手势接管（边缘滑动、控制中心下拉）、WKWebView 滚动
     * 接管手指 等触发。语义是"平台强制结束本次接触"，必须无条件清掉 drag 状态，
     * 否则会演变成"残留 dragIndex/dragTouchId → 后续 dock/顶栏皆点不响应"的僵尸 bug。
     *
     * 与 onTouchEnd 区别：END 是用户主动松手，可能要"按位置吸附落子"；CANCEL 是平台中断，
     * 直接放弃当前拖拽即可，不应触发 placeAt。
     */
    private onTouchCancel(_e: EventTouch): void {
        if (this.dragIndex < 0) return;
        if (DEBUG_TOUCH) console.warn(`[OpenBlock] TOUCH_CANCEL force-reset drag idx=${this.dragIndex}`);
        this.cancelDrag();
    }

    private onTouchEnd(e: EventTouch): void {
        const loc = e.getLocation();
        // ⭐ Cocos 3.8 + iOS 边缘手势冲突的 bug 兜底：同一坐标 + 同一 touchId 的 touch-end 事件
        // 偶发被引擎以 50Hz+ 频率重复派发（用户日志可见每 20ms 一次），造成 dispatchTap → 任何按钮
        // 监听器都被调用上百次，UI 假性"卡死"。这里加 16ms + 同坐标去重，把噪声压回单次。
        const tid = (() => { try { return e.getID(); } catch { return -1; } })();
        const now = Date.now();
        const lx = loc.x | 0;
        const ly = loc.y | 0;
        // ⭐ 坐标无关的事件风暴守卫（修复「激活候选块未放置 → 整个界面无响应」）：
        // 引擎在 iOS/安卓输入卡死或边缘手势冲突时，会在【多个坐标间交替】高频重发 touch-end
        // （日志可见 (611,262)/(247,431) 两点每数毫秒交替刷屏），同坐标 60ms 去重完全抓不到，
        // 每个事件还各跑一次 dispatchTap + console.log（原生端 log 是昂贵 IPC）→ 主线程被打满假死。
        // 这里按"滚动 1s 窗内 touch-end 总次数"判定：真实玩家每秒至多数次，超 25 次必为引擎风暴 →
        // 直接丢弃（不分发、不打日志）并周期性自愈（cancel 残留 drag + reset Modal），让交互恢复。
        if (now - this._touchEndWindowStartMs > 1000) {
            this._touchEndWindowStartMs = now;
            this._touchEndWindowCount = 0;
        }
        this._touchEndWindowCount++;
        if (this._touchEndWindowCount > 25) {
            if (this._touchEndWindowCount % 120 === 26) {
                console.warn(`[OpenBlock] touch-end FLOOD (rate>25/s) suppressing + self-heal; drag=${this.dragIndex} modalOpen=${Modal.isOpen() ? 1 : 0}`);
                try { if (this.dragIndex >= 0) this.cancelDrag(); } catch { /* ignore */ }
                try { Modal.reset(); } catch { /* ignore */ }
            }
            return;
        }
        if (
            this._lastTouchEndTouchId === tid
            && this._lastTouchEndX === lx
            && this._lastTouchEndY === ly
            && now - this._lastTouchEndAtMs < 60
        ) {
            this._dupTouchEndCount++;
            // 每 30 个去重打一次 warn，便于 Xcode 看到"事件风暴正在被抑制"。
            if (this._dupTouchEndCount % 30 === 1) {
                console.warn(`[OpenBlock] touch-end dedupe: tid=${tid} (${lx},${ly}) suppressed ${this._dupTouchEndCount} dup events in last burst`);
            }
            // Flood self-heal：连续 100+ 重复事件 = Cocos input 卡死（iOS 边缘手势冲突）。
            // 主动 reset Modal 计数 + cancel 任何残留 drag，让玩家恢复交互。
            if (this._dupTouchEndCount === 100) {
                console.warn(`[OpenBlock] touch-end flood self-heal triggered: reset Modal + cancelDrag (Cocos input stuck on iOS edge gesture)`);
                try { if (this.dragIndex >= 0) this.cancelDrag(); } catch { /* ignore */ }
                try { Modal.reset(); } catch { /* ignore */ }
            }
            return;
        }
        this._lastTouchEndTouchId = tid;
        this._lastTouchEndX = lx;
        this._lastTouchEndY = ly;
        this._lastTouchEndAtMs = now;
        this._dupTouchEndCount = 0;

        // 模态/菜单按钮命中：仅在 END 阶段分发一次（START 已不再分发）。
        if (this.dragIndex < 0) {
            console.log(`[OpenBlock] touch-end at (${loc.x | 0},${loc.y | 0}) drag=none → dispatchTap`);
            this.dispatchTap(e);
            return;
        }
        const heldMs = this.dragStartedAtMs ? Date.now() - this.dragStartedAtMs : 0;
        // 多指：非主拖拽手指抬起不结束拖拽，仅静默忽略。
        // 注意：dragTouchId 缺失则 isOwnTouch 返回 true（默认放行），保证单指环境不会自锁。
        if (!this.isOwnTouch(e)) { console.log(`[OpenBlock] touch-end foreign-touchId ignored`); return; }
        if (this.shouldAbortDragNow()) {
            console.log(`[OpenBlock] touch-end abort (modal/meta/over) idx=${this.dragIndex}`);
            this.cancelDrag();
            return;
        }
        // ⭐ deferred tap-or-drag 落地：手指未发生位移 → 执行 onTouchStart 设定的延迟动作。
        // 若手指有过位移，dragMoved=true → 不进本分支，走下方 DRAG-RELEASE 正常拖拽结算。
        if (this._pendingTapAction && !this.dragMoved) {
            const action = this._pendingTapAction;
            this._pendingTapAction = null;
            console.log(`[OpenBlock] tap-action ${action} idx=${this.dragIndex} held=${heldMs}ms`);
            if (action === 'place') {
                this.tryTapPlaceAtTouch(e);
            } else {
                // 'deselect'
                this.cancelDrag();
                try { this.dock.render(this.model.dock, this.model.skin); } catch { /* ignore */ }
            }
            return;
        }

        // 仅激活未拖动（tap-release，无位移）：进入 tap-to-select 选中态，ghost 保持悬浮，
        // 等待下一次 tap 完成「点板落子」或「点 dock 切换/取消」。这是休闲方块拼图（Block Blast 等）
        // 主流的触屏交互范式 —— 用户不必"始终按住"，对长形/大块尤其友好。
        //
        // ⭐ 关键：tap-no-drag 时 ghost **不应用 lift**（lift 会把方块抬到棋盘顶部，违反"点击只在候选区显示"），
        // 而是钉在 dock 槽中心。只有真的开始拖动后，moveGhost 才会施加 lift 让方块跟手抬起。
        if (!this.dragMoved) {
            this._tapSelected = true;
            this.placeGhostAtDockSlot(this.dragIndex);
            // 清掉 beginDockDrag→updateSnap 在板面残留的 ghost 落点预览：tap-no-drag 不该看到落点提示，
            // 等用户真的点板面那一刻才计算并显示。这是「点击只在候选区渲染」的完整闭环。
            this.snap = null;
            try { this.board.render(this.model.grid, this.model.skin); } catch { /* ignore */ }
            console.log(`[OpenBlock] touch-end TAP-SELECT idx=${this.dragIndex} held=${heldMs}ms → enter selected-state (ghost anchored at dock slot, awaiting place tap)`);
            this.startSelectedPulse();
            return;
        }
        console.log(`[OpenBlock] touch-end DRAG-RELEASE idx=${this.dragIndex} held=${heldMs}ms at (${loc.x | 0},${loc.y | 0})`);
        const idx = this.dragIndex;
        const previewClearSnap = this.currentPreviewClearSnap();
        if (previewClearSnap) {
            console.log(`[OpenBlock] touch-end PREVIEW-CLEAR PLACE idx=${idx} at grid=(${previewClearSnap.gx},${previewClearSnap.gy})`);
            this.cancelDrag();
            this.model.placeAt(idx, previewClearSnap.gx, previewClearSnap.gy);
            this.board.render(this.model.grid, this.model.skin);
            this.dock.render(this.model.dock, this.model.skin);
            return;
        }
        // 释放时只做小半径容错；明显不可放则回候选区。
        this.updateSnap(e, true);
        const snap = this.snap;
        const canPlace = snap && this.model.canPlaceBlock(idx, snap.gx, snap.gy);
        const releaseLoc = e.getLocation();
        const overDock = this.dock.isScreenInDockArea(releaseLoc.x, releaseLoc.y);
        if (canPlace) {
            this.cancelDrag();
            this.model.placeAt(idx, snap.gx, snap.gy);
        } else if (overDock) {
            // 温柔取消：松手在 dock 区域内，明确表达"我不要了，放回去"。
            // 不做 reject 抖动（那是"放在盘面非法格"的负反馈），只走 cancelDrag 让候选块平滑归位。
            this.cancelDrag();
        } else {
            // 非法释放：把候选块放回 dock，并在 ghost 原位播 reject 抖动+淡出（对齐 web `#drag-ghost.is-rejected`），
            // 比直接消失更明确地告诉玩家"这一格不能落"。计入本局 miss（命中率统计）。
            this.game.misses++;
            try { this.profile?.recordMiss?.(); } catch { /* ignore */ }
            this.cancelDrag(true); // 保留 ghost 渲染供抖动
            this.fx.ghostRejectShake(this.ghost);
            AudioManager.sfxInvalid();
            Haptics.light();
        }
        this.board.render(this.model.grid, this.model.skin);
        this.dock.render(this.model.dock, this.model.skin);
    }

    private updateSnap(e: EventTouch, release = false): void {
        if (!this.dragShape) return;
        const loc = e.getLocation();
        // 指尖是否回到 dock 区域：true → dock 把原槽以半透明形式画回去，提示"松手放回这里取消"；
        // false → 槽位完全空（候选块全在指尖 ghost 上）。dock 内部带值不变守卫，每帧调用零开销。
        this.dock.setHoverBackOverDock(this.dock.isScreenInDockArea(loc.x, loc.y));
        const aimLoc = this.dragControlScreenPoint(loc.x, loc.y);
        const bl = screenToLocal(this.board.node, aimLoc.x, aimLoc.y);
        // lift 必须与 ghost 实际渲染位置一致，否则 snap 高亮格会与 ghost 错开（「双重渲染」bug）：
        //   - 拖拽中（dragMoved=true）：ghost = touch + lift*ramp，snap 同步走 ramp
        //   - tap-select 落子点击（!dragMoved, _tapSelected=true）：ghost = touch（无 lift），
        //     落子要求"点哪儿落哪儿" → snap 也无 lift
        //   - 激活刚发生（!dragMoved, !_tapSelected）：ghost 在指尖原位，snap 通常未被调用
        // ⭐ 与 ghost 严格同步：使用 _liftFactor（时间驱动）而非临时算 ramp，否则 snap 高亮会与 ghost 错位。
        // tap-no-drag（dragMoved=false）下 _liftFactor 保持 0，与 ghost 钉在槽中心一致。
        bl.y += this.dragLiftPx() * this._liftFactor;
        const cell = this.board.cellSize;
        const half = this.board.boardPx / 2;
        const fx = (bl.x + half) / cell;
        const fy = (half - bl.y) / cell;
        // ⭐ anchor 公式：`round(aim - w/2)` —— ghost 视觉中心与落点 cell 严格对齐。
        //    cocos 端 ghost 就是 preview（单层渲染），所以必须用 round 而不是 web 的 floor。
        //    详见 Grid.naiveAnchorFromAim 文档。
        const { anchorX, anchorY } = Grid.naiveAnchorFromAim(this.dragShape, fx, fy);

        if (release) {
            // ⭐ 释放策略（严格对齐 web `Game.onEnd` / miniprogram `_finishDrag`）：走 pickSmartHoverPlacement
            //    在 `placeReleaseRadius` 半径内择优——优先消行点，其次最近，**不附带 sticky**（释放不应受
            //    上一帧预览粘滞影响）。半径轻微增加（1→2）以减少边界抖动 miss，仍走曼哈顿距离权重，
            //    避免对角"窜两格"。anchor 严格命中（d=0）时被距离权重天然排在最前，所见即所得不打折扣。
            const placed = this.model.grid.pickSmartHoverPlacement(
                this.dragShape, fx, fy, anchorX, anchorY, SNAP.placeReleaseRadius,
                {
                    colorIdx: this.dragColor,
                    previous: this.snap ? { x: this.snap.gx, y: this.snap.gy } : null,
                    clearLineBonus: SNAP.clearLineBonus,
                    clearCellBonus: SNAP.clearCellBonus,
                    clearAssistWindow: SNAP.clearAssistWindow,
                    // 释放路径不要 sticky：避免「拖偏后松手仍粘在上一帧 hover 预览」造成不可预期落点。
                    stickyBonus: 0,
                    stickyWindow: 0,
                },
            );
            this.snap = placed ? { gx: placed.x, gy: placed.y } : null;
        } else {
            // 拖拽中保留 hover smart-snap：±placeRadius 内取最优（消行加权 + 距离 + 粘滞）。
            // aimAssist 开启时半径 +1，扩大消行候选搜索范围（cocos 端独有 QoL，web 端无此功能）。
            const radius = SNAP.placeRadius + (this.aimAssist ? 1 : 0);
            const prev = this.snap ? { x: this.snap.gx, y: this.snap.gy } : null;
            const best = this.model.grid.pickSmartHoverPlacement(
                this.dragShape, fx, fy, anchorX, anchorY, radius,
                {
                    colorIdx: this.dragColor,
                    previous: prev,
                    clearLineBonus: SNAP.clearLineBonus,
                    clearCellBonus: SNAP.clearCellBonus,
                    clearAssistWindow: SNAP.clearAssistWindow,
                    // 与 web onMove 同款"降权 sticky"：×0.35 / ×0.55，避免预览在边界抖动同时不至于过粘
                    stickyBonus: SNAP.stickyBonus * 0.35,
                    stickyWindow: SNAP.stickyWindow * 0.55,
                },
            );
            this.snap = best ? { gx: best.x, gy: best.y } : null;
            // 智能吸附落地虚影：hover 时在真实吸附落点画候选块（落点常因 smart-snap ≠ 指尖跟手块位置），
            // 让玩家除了「待消行高亮」外，也能直接看到方块会被放入的位置。
            this.renderLandingGhost();
        }
        // ⚡ 拖拽期不再每帧全量 board.render()：盘面格数据在拖拽中不变（落子只发生在 touch-end），
        //   跟手块是独立的 `Ghost` 节点（moveGhost 驱动），落点高亮在独立的 L7 层（updatePreviewClearHint
        //   自行 clear+重画）。旧实现每 touch-move 全清重画 64 格底色 + 水印 + 网格线 + 全部已放方块
        //   （paintBlockFace 每格 6+ 次 Graphics 指令），60fps 拖拽 = 每秒数千条多余绘制指令。
        //   落子判定用 this.snap；盘面落点处由 renderLandingGhost() 画一层更淡的「落地虚影」（独立 L6，自带 clear），
        //   它与指尖跟手块（全不透明）通过 alpha 区分——smart-snap 落点≠指尖时尤其有用，让玩家看清会放入哪。
        //   release 分支由 onTouchEnd 紧随的 board.render() 收口，盘面状态（含 L6）最终一定刷新。
        // ⭐ 潜在消行高亮（对齐 web `_getPreviewClearCells` + `renderPreviewClearHint`）：
        //   snap 存在 + canPlace + 计算后有 cells → 把整行/整列的高亮喂给 BoardView，自带 30Hz 脉冲；
        //   其余情况一律清空。BoardView 内部按 cells 引用 + 状态翻转去重，零开销路径不重画。
        this.updatePreviewClearHint();
    }

    /**
     * 落点潜在消行 hint 计算 —— 算法与 web `Game._getPreviewClearCells` 等价：
     *   只在 snap 存在 + canPlaceBlock 通过 时，调用 `grid.previewClearOutcome(shape, gx, gy, colorIdx)`。
     *   该方法返回 `{ rows, cols, cells }`，其中 cells 是受影响的全部格（包含已有方块格 + ghost 落点格）。
     *   缓存 key 与 web 同结构：`${colorIdx}:${gx},${gy}:${shapeKey}` —— snap 位姿未变则零开销路径直接返回。
     *
     * 调用时机：每次 updateSnap 末尾（拖拽中每 touch-move 一次，释放也走 release path 一次）。
     * 清除时机：snap 为空 / canPlace 失败 / cancelDrag。
     */
    private _lastPreviewClearKey: string | null = null;
    private currentPreviewClearSnap(): { gx: number; gy: number } | null {
        if (!this.snap || !this.dragShape || this.dragIndex < 0) return null;
        const { gx, gy } = this.snap;
        if (!this.model.canPlaceBlock(this.dragIndex, gx, gy)) return null;
        const outcome = this.model.grid.previewClearOutcome(this.dragShape, gx, gy, this.dragColor);
        return outcome?.cells?.length ? { gx, gy } : null;
    }

    private updatePreviewClearHint(): void {
        if (!this.snap || !this.dragShape || this.dragIndex < 0) {
            this._lastPreviewClearKey = null;
            this.board.setPreviewClearHint(null);
            return;
        }
        const { gx, gy } = this.snap;
        // 与 web 完全一致的缓存键 —— 拖动中同位姿连续 touch-move 时直接命中，省掉一次 O(n²) 计算。
        const shapeKey = this.dragShape.map((row) => row.join('')).join('|');
        const key = `${this.dragColor}:${gx},${gy}:${shapeKey}`;
        if (key === this._lastPreviewClearKey) return; // 位姿未变：脉冲由 BoardView.update 自驱，无需重算
        this._lastPreviewClearKey = key;
        const outcome = this.model.grid.previewClearOutcome(this.dragShape, gx, gy, this.dragColor);
        this.board.setPreviewClearHint(outcome?.cells?.length ? outcome.cells : null);
    }

    /**
     * 智能吸附落地虚影（L6 ghost）：在真实吸附落点 `this.snap` 处以更低 alpha 画候选块。
     *
     * 指尖跟手块（this.ghost）跟随手指（touch+lift），而 smart-snap 的实际落点由
     * `pickSmartHoverPlacement` 在半径内择优，二者常不重合——此前盘面落点处没有任何方块、
     * 只剩「待消行高亮」悬空，玩家无法直观看到方块会被放到哪。此虚影补齐落点候选块显示。
     *
     * 仅 hover（非 release）调用；落子/取消后由 board.render() 自动清掉 L6。
     */
    private renderLandingGhost(): void {
        if (this.snap && this.dragShape && this.dragIndex >= 0
            && this.model.canPlaceBlock(this.dragIndex, this.snap.gx, this.snap.gy)) {
            this.board.renderGhost(
                this.model.grid, this.model.skin, this.dragShape,
                this.snap.gx, this.snap.gy, this.dragColor, SNAP.landingGhostAlpha,
            );
        } else {
            this.board.clearGhost();
        }
    }

    private drawGhost(): void {
        const g = this.ghost.getComponent(Graphics) || this.ghost.addComponent(Graphics);
        g.clear();
        if (!this.dragShape) return;
        const skin = this.model.skin;
        // 与 web `_boardDisplayCellSize()` 对齐：拖拽 ghost 用盘面 cell 大小绘制，
        // 与 BoardView.renderGhost 的落点预览同尺寸，让"指尖跟手块"与"盘面落点预览"
        // 视觉上属于同一块（避免大小撕裂）。dock 中的小尺寸只是候选缩略图。
        // 同 dock 一样走 drawShapeFaces 单一管线（含 emoji 图标），保证立体面/圆角/icon 与候选块一致。
        const cell = this.board.cellSize;
        const sw = this.dragShape[0].length;
        const sh = this.dragShape.length;

        const uit = this.ghost.getComponent(UITransform) || this.ghost.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        uit.setContentSize(sw * cell, sh * cell);

        /* iOS 原生端强兜底：
         * 系统 emoji Label 即使清 string / cacheMode=NONE，仍可能因为底层 Apple Color Emoji glyph atlas
         * 复用旧字号，导致「ghost 方块用 board cell 放大了，但 emoji 仍是 dock 小字号」。
         * 拖拽 ghost 每次激活最多几个格子，销毁重建成本极低；这里不再复用 _ghostIcons 池，
         * 而是每次 drawGhost 都新建整棵 icon root，确保 glyph 以当前 board cell 的 fontSize 首次烘焙。 */
        if (this._ghostIconRoot?.isValid) {
            try { this._ghostIconRoot.destroy(); } catch { /* ignore */ }
        }
        this._ghostIcons = [];
        this._ghostIconRoot = new Node('ghostIcons');
        this._ghostIconRoot.parent = this.ghost;
        // 与 dock 渲染一致：图标根节点继承 ghost 所在 layer，避免 UI camera 漏渲染。
        inheritLayer(this._ghostIconRoot, this.ghost);
        this._ghostIconRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._ghostIconRoot.setScale(1, 1, 1);
        // 把 icon 根置于 Graphics 之上，确保图标绘制在立体面之上（与 dock `_iconRoot` 行为一致）。
        this._ghostIconRoot.setSiblingIndex(9999);

        // 方块面用盘面 cell 绘制；emoji 不走 drawShapeFaces 的 fontSize 路径，改由下方手动缩放。
        drawShapeFaces(g, skin, {
            shape: this.dragShape,
            colorIdx: this.dragColor,
            cell,
            left: -(sw * cell) / 2,
            top: (sh * cell) / 2,
        });
        this.drawGhostIconsScaled(cell, sw, sh);
    }

    /**
     * iOS emoji 缓存最终兜底：
     * - 用 dock 字号生成 emoji glyph（iOS 即便复用旧小 glyph，也正是这个尺寸）；
     * - 再按 boardFace / dockFace 缩放 Label 节点，让视觉尺寸严格等于拖拽 ghost 方块面。
     *
     * 这避免依赖 iOS 原生对 system-font Label 的 fontSize 重新烘焙，从「改 glyph 尺寸」
     * 转为「缩放节点」，因此能稳定解决“方块放大了但 emoji 没放大”。
     */
    private drawGhostIconsScaled(cell: number, sw: number, sh: number): void {
        if (!this.dragShape || !this._ghostIconRoot?.isValid) return;
        const skin = this.model.skin;
        const em = blockIcon(skin, this.dragColor);
        if (!em) return;

        const dockCell = Math.max(1, this.dock?.cell || cell);
        const dockFace = Math.max(1, dockCell - blockMetrics(skin, dockCell).inset * 2);
        const boardFace = Math.max(1, cell - blockMetrics(skin, cell).inset * 2);
        const fs = iconFontSize(dockFace);
        if (fs <= 0) return;
        const scale = Math.max(1, boardFace / dockFace);
        const left = -(sw * cell) / 2;
        const top = (sh * cell) / 2;
        let iconN = 0;

        for (let y = 0; y < this.dragShape.length; y++) {
            for (let x = 0; x < this.dragShape[y].length; x++) {
                if (!this.dragShape[y][x]) continue;
                const n = new Node('gic');
                n.parent = this._ghostIconRoot;
                inheritLayer(n, this._ghostIconRoot);
                n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
                n.setPosition(left + x * cell + cell / 2, top - (y + 1) * cell + cell / 2, 0);
                n.setScale(scale, scale, 1);
                const l = n.addComponent(Label);
                l.color = new Color(255, 255, 255, 255);
                l.useSystemFont = true;
                l.fontFamily = ICON_FONT_FAMILY;
                l.fontSize = fs;
                l.lineHeight = fs;
                l.string = em;
                if (Label.Overflow) l.overflow = Label.Overflow.NONE;
                if (Label.HorizontalAlign) l.horizontalAlign = Label.HorizontalAlign.CENTER;
                if (Label.VerticalAlign) l.verticalAlign = Label.VerticalAlign.CENTER;
                try {
                    const anyL = l as unknown as {
                        cacheMode?: unknown;
                        markForUpdateRenderData?: (force?: boolean) => void;
                    };
                    const CacheModeEnum = (Label as unknown as { CacheMode?: { NONE?: unknown } })?.CacheMode;
                    if (CacheModeEnum?.NONE != null) anyL.cacheMode = CacheModeEnum.NONE;
                    anyL.markForUpdateRenderData?.(true);
                } catch { /* ignore */ }
                this._ghostIcons[iconN++] = l;
            }
        }
    }

    /**
     * ghost 锚到指尖局部坐标，**不带 lift**（lift 由 moveGhost 的 ramp 渐进供给）。
     * dragOriginX/Y 设为指尖局部坐标，使 moveGhost 的 `(curL − startL)` 相对位移
     * 与初始触点完全一致，从而 ghost 与手指 1:1 同步、snap 高亮与 ghost 完全重合
     * （只看到一个方块）。
     *
     * 设计取舍：之前激活瞬间满 lift 会把方块直接抬到棋盘顶部；ramp 渐进既保持「拖远了
     * 方块在手指上方易见」的体验，又消除了「初始定位 jump」与「双重渲染」两个 bug。
     */
    private placeGhostAtTouch(loc: { x: number; y: number }): void {
        const parent = this.ghost.parent || this.ghost;
        const local = screenToLocal(parent, loc.x, loc.y);
        this.dragOriginX = local.x;
        this.dragOriginY = local.y;
        this.ghost.setPosition(local.x, local.y, 0);
    }

    /**
     * tap-to-select 选中态下把 ghost 钉在指定 dock 槽的正上方（候选区内，不抬到棋盘上）。
     * 设计：ghost 用板面 cell 尺寸绘制（放大版本），中心点对齐 dock 槽中心，**不应用 lift**，
     * 这样视觉上始终留在候选区，只是"被抓起来悬浮一点点" —— 符合「点击不拖动时只在候选区渲染」的预期。
     * dragOriginX/Y 同时更新，让后续若用户改成拖动（先 tap → 再 hold-drag）也能从此点平滑过渡。
     */
    private placeGhostAtDockSlot(index: number): void {
        if (!this.dragShape) return;
        const parent = this.ghost.parent;
        const dockNode = this.dock.node;
        if (!parent || !dockNode?.isValid) return;
        // dock 和 ghost 在 Bootstrap.node 下平级，dock 的 position 已是 ghost 父空间下的坐标。
        const dockPos = dockNode.position;
        const slotLocalX = this.dock.slotCenterX(index);
        const targetX = dockPos.x + slotLocalX;
        // y 取 dock 节点中心；ghost 锚点 0.5，板面 cell 尺寸的方块自然居中于槽内（略微向上溢出到候选区上方）。
        const targetY = dockPos.y;
        this.dragOriginX = targetX;
        this.dragOriginY = targetY;
        this.ghost.setPosition(targetX, targetY, 0);
    }

    /**
     * 触屏 ghost 上抬量（clearance-based）：lift = blockHalf + GAP·cell。
     *
     * 几何含义：ghost 锚点 (0.5,0.5) → ghost 中心 = 指尖 + lift（指尖向上抬 lift 像素）。
     *   ghost 底边 = ghost 中心 − blockHalf = 指尖 + GAP·cell —— 即 **底边距指尖恒定 GAP 个格高**。
     *
     * 为什么不再 cap：cap 之后大块（5×1 直立）底边沉到指尖之下，玩家看不见"块底贴哪格"，
     * 必须脑补偏移 → 体感"慢/不准"。clearance 公式让所有块都"块底贴在指尖上方一指距离"，
     * "指哪打哪"的紧贴感对齐 Block Blast / Wood Block。
     *
     * 桌面/鼠标路径无 lift（与 web `isTouch` 判定一致）。
     */
    private dragLiftPx(): number {
        if (!this.dragShape) return 0;
        if (!(sys.isMobile || sys.isNative)) return 0;
        const cell = this.board.cellSize;
        const blockHalf = (this.dragShape.length * cell) / 2;
        return blockHalf + DRAG_TOUCH_LIFT_GAP_CELLS * cell;
    }

    /**
     * 跟手位移：水平按触屏倍率跟手，垂直 lift 由 update() 按 LIFT_RAMP_MS 时间独立推进 ——
     * 水平与垂直完全解耦，消除「拖动起步斜挑感」（此前距离驱动 ramp 的根本缺陷）。
     *
     * 公式：ghost = dragOrigin + (cur − start) + lift × _liftFactor
     *   _liftFactor 由 update() / advanceLiftRamp() 按 elapsed/LIFT_RAMP_MS 时间线性推进，
     *   与手指 horizontal motion 无关；即便手指停在原地，lift 也会继续渐进就位。
     */
    private moveGhost(e: EventTouch): void {
        const loc = e.getLocation();
        this._lastTouchScreenX = loc.x;
        this._lastTouchScreenY = loc.y;
        const dist = Math.hypot(loc.x - this.dragStartScreenX, loc.y - this.dragStartScreenY);
        if (dist >= DRAG_MOVE_THRESHOLD && !this.dragMoved) {
            this.dragMoved = true;
            // ⭐ 升级为 drag：作废待定 tap action，避免 onTouchEnd 同时跑落子/取消和拖拽结算两套逻辑。
            this._pendingTapAction = null;
            // 启动 lift 时间驱动渐进。
            this._dragMovedAtMs = Date.now();
            this._liftFactor = 0;
        }
        if (!this.dragMoved) return; // 阈值内的微小抖动：ghost 不动，保持槽中心。

        this.repositionGhost(loc.x, loc.y);
    }

    /**
     * 按给定屏幕坐标 + 当前 _liftFactor 重摆 ghost。供 moveGhost（指尖动）与 update()（指尖不动但 lift 还在渐进）共用。
     * 水平方向按触屏倍率跟手；垂直方向 = 跟手 + dragLiftPx · _liftFactor —— horizontal 与 vertical 完全解耦。
     */
    private repositionGhost(screenX: number, screenY: number): void {
        const parent = this.ghost.parent || this.ghost;
        const startL = screenToLocal(parent, this.dragStartScreenX, this.dragStartScreenY);
        const aim = this.dragControlScreenPoint(screenX, screenY);
        const curL = screenToLocal(parent, aim.x, aim.y);
        const lift = this.dragLiftPx();
        this.ghost.setPosition(
            this.dragOriginX + (curL.x - startL.x),
            this.dragOriginY + (curL.y - startL.y) + lift * this._liftFactor,
            0,
        );
    }

    private dragControlScreenPoint(screenX: number, screenY: number): { x: number; y: number } {
        const gain = (this.dragMoved && (sys.isMobile || sys.isNative)) ? DRAG_TOUCH_TRACK_GAIN : 1;
        return {
            x: this.dragStartScreenX + (screenX - this.dragStartScreenX) * gain,
            y: this.dragStartScreenY + (screenY - this.dragStartScreenY) * gain,
        };
    }

    private cancelDrag(keepGhost = false): void {
        // 即便 cancelDrag 内部某一步抛错（如 dock.render 在皮肤切换中途访问空 skin），
        // 也要先把核心 drag 状态原子归零，再做副作用清理；否则会留下"画面已恢复但 dragIndex 仍 >=0"的僵尸态。
        this.dragIndex = -1;
        this.dragShape = null;
        this.snap = null;
        this.dragMoved = false;
        this.dragTouchId = null;
        this.dragStartedAtMs = 0;
        this.dragLastSeenAtMs = 0;
        this._tapSelected = false;
        this._pendingTapAction = null;
        this._liftFactor = 0;
        this._dragMovedAtMs = 0;
        // ⭐ 同步清掉落点潜在消行高亮 —— 否则 cancelDrag 后 BoardView.update 会继续脉冲一闪
        this._lastPreviewClearKey = null;
        try { this.board?.setPreviewClearHint(null); } catch { /* ignore */ }
        try { this.dock.clearDraggingSlot(); } catch (err) { console.warn('[OpenBlock] cancelDrag clearSlot', err); }
        // keepGhost：非法释放走 reject 抖动时保留 ghost 当前渲染（含 emoji 图标），让它在原地抖动+淡出；
        // 下一次激活的 prepareGhost 会复位 opacity/scale/position 并重绘，不会残留。
        if (!keepGhost) {
            try {
                const g = this.ghost.getComponent(Graphics);
                if (g) g.clear();
                for (const l of this._ghostIcons) if (l?.node) l.node.active = false;
            } catch (err) { console.warn('[OpenBlock] cancelDrag ghost', err); }
        }
        try {
            if (this.board && this.model) {
                this.board.render(this.model.grid, this.model.skin);
            }
        } catch (err) { console.warn('[OpenBlock] cancelDrag boardRender', err); }
    }

    // ---- skin + save ----

    /** 打开皮肤选择面板（对齐 web 的皮肤列表选择器；点选即应用并持久化）。 */
    openSkinPanel(): void {
        SkinPanel.show(this.node, this.model.skin.id, (id) => this.applySkin(id));
    }

    /** 打开皮肤图鉴（对齐 web skinLore）：分页叙事卡，可直接「使用此皮肤」。 */
    openLore(): void {
        LorePanel.show(this.node, this.model.skin.id, (id) => this.applySkin(id));
    }

    /** 打开回放列表（对齐 web replay）：选一局进入回看器。 */
    openReplays(): void {
        ReplayPanel.show(this.node);
    }

    /** 应用指定皮肤：转场覆层 + 刷新盘面/候选区/背景并持久化（对齐 web skinTransition）。 */
    applySkin(id: string): void {
        if (id === this.model.skin.id) return;
        // 换肤期间禁止拖拽穿透，并视为模态（与 web 切肤遮罩对齐）。
        this.cancelDrag();
        const next = getSkin(id);
        Modal.open();
        // 对齐 web `skinTransition.js:91`：换肤起手播 unlock 音，转场结束后皮肤焕新。
        AudioManager.sfxUnlock();
        Haptics.light();
        playSkinTransition(this.node, next, () => {
            this.applySkinImmediate(id);
            Modal.close();
        });
    }

    private applySkinImmediate(id: string): void {
        this.model.setSkin(id);
        this.board.setSkin(this.model.skin);
        const g = this.bgNode.getComponent(Graphics);
        if (g) {
            g.clear();
            g.fillColor = bgColor(this.model.skin);
            g.rect(-1000, -1500, 2000, 3000);
            g.fill();
        }
        this.fx.startAmbience(seasonalAccent());
        this.ambientFx.applySkin(id);
        this.renderAll();
        this.refreshHudSkin();
        this.companionView?.setSkin(this.model.skin.id, this.companion.level());
        Storage.set(STORAGE_KEYS.skin, this.model.skin.id);
        this.save();
    }

    /** 把当前皮肤的强调色同步到 HUD（得分 / 最佳数值上色）。 */
    private refreshHudSkin(): void {
        this.hud.setAccent(accentColor(this.model.skin));
    }

    /** 循环切换下一款皮肤（保留旧入口，便于快捷切换）。 */
    cycleSkin(): void {
        const ids = listSkinIds();
        const cur = ids.indexOf(this.model.skin.id);
        this.applySkin(ids[(cur + 1) % ids.length]);
    }

    toggleMeta(): void {
        this.metaPanel.toggle();
    }

    private save(): void {
        Storage.setJSON(STORAGE_KEYS.save, this.model.toJSON());
        Storage.setJSON(STORAGE_KEYS.meta, this.meta.toJSON());
        Storage.setNumber(STORAGE_KEYS.best, this.model.best);
        Storage.setNumber(STORAGE_KEYS.coins, this.model.wallet.coins);
        Storage.set(STORAGE_KEYS.skin, this.model.skin.id);
        Storage.setJSON(STORAGE_KEYS.progression, this.progression.toJSON());
        Storage.setJSON(STORAGE_KEYS.achievements, this.achievements.toJSON());
        Storage.setJSON(STORAGE_KEYS.season, this.seasonPass.toJSON());
        Storage.setJSON(STORAGE_KEYS.seasonChest, this.seasonChest.toJSON());
        Storage.setJSON(STORAGE_KEYS.daily, this.daily.toJSON());
        Storage.setJSON(STORAGE_KEYS.stats, this.stats);
        Storage.setJSON(STORAGE_KEYS.companion, this.companion.toJSON());
        try { this.profile?.save?.(); } catch { /* ignore */ }
        if (flag('cloudSave')) {
            CloudSync.push({ best: this.model.best, coins: this.model.wallet.coins, save: this.model.toJSON(), ts: Date.now() });
        }
    }

    /* ───────────── evaluationHost 契约（v1.69 Phase 1，仅 spawn + gameOver） ───────────── */

    getGridCells(): any { return (this.model?.grid as any)?.toJSON?.()?.cells || null; }
    getDockBlocks(): any { return this.model?.dock || []; }
    getAdaptiveInsight(): any { return (this as any)._lastSpawnInsight || null; }
    getSpawnDiagnostics(): any { return (this as any)._lastSpawnDiagnostics || null; }
    getStress(): number {
        const ins: any = (this as any)._lastSpawnInsight;
        return Number(ins?._adaptiveStress) || 0;
    }
    getRulesConfig(section: string, fallback: any): any {
        return (GAME_RULES_DATA as any)?.[section] || fallback || {};
    }
    getPlayerProfileRef(): any { return this.profile || null; }
    getUserId(): string | null { return (this.profile as any)?.userId || null; }
    getStrategy(): string | null { return this.model?.mode || null; }
    getPlayerProfileSnapshot(): any {
        const p: any = this.profile;
        if (!p) return {};
        return {
            lifecycleStage: p.lifecycleStage || null,
            maturityBand: p.maturityBand || null,
            flowState: p.flowState || null,
        };
    }
    postSessionEvalRecord(record: any): Promise<void> {
        return new Promise<void>((resolve) => {
            try {
                /* Cocos 端走 globalThis.fetch（与 CloudSync.ts 同源），无 fetch 时静默 skip。 */
                const f = (globalThis as any).fetch;
                if (typeof f !== 'function') { resolve(); return; }
                const base = (getConfig() as any)?.apiBase || '';
                if (!base) { resolve(); return; }
                f(`${base}/api/evaluation/session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(record),
                })
                    .catch(() => undefined)
                    .finally(() => resolve());
            } catch { resolve(); }
        });
    }
}
