import { _decorator, Component, Node, Graphics, UITransform, Vec3, Color, Label, input, Input, EventTouch } from 'cc';
import {
    GameModel, GameEvent, ShapeMatrix, MetaState, findHint, listBestPlacements, SKILLS, SkillId,
    Progression, AchievementState, SeasonPass, DailyState, listSkinIds, getSkin, t,
    getConfig, flag, Analytics, ANALYTICS_EVENTS, openChest, spinWheel, GameMode, MODE_ORDER, getMode,
    PlayerContext, CompanionState, getCompanion, ReplayRecorder,
} from '../core';
import { BoardView } from './BoardView';
import { DockView } from './DockView';
import { Hud } from './Hud';
import { LineClearFx } from './effects/LineClearFx';
import { FxLayer } from './effects/FxLayer';
import { ScreenShake } from './effects/ScreenShake';
import { SkillBar } from './skills/SkillBar';
import { MetaPanel } from './ui/MetaPanel';
import { ModalPanel } from './ui/ModalPanel';
import { WheelPanel } from './ui/WheelPanel';
import { SkinPanel } from './ui/SkinPanel';
import { LorePanel } from './ui/LorePanel';
import { ReplayPanel } from './ui/ReplayPanel';
import { ReplayStore } from './platform/ReplayStore';
import { CompanionView } from './companion/CompanionView';
import { playSkinTransition } from './effects/SkinTransition';
import { Modal, TapBus, screenToLocal } from './ui/uiKit';
import { guard, reportFatal } from './ui/Fatal';
import { blockMetrics, blockIcon, blockColor, bgColor } from './skin/palette';
import { paintBlockFace, iconFontSize } from './skin/blockPaint';
import { seasonalAccent } from './skin/seasonalSkin';
import { Storage, STORAGE_KEYS } from './platform/Storage';
import { AudioManager } from './audio/AudioManager';
import { Haptics } from './platform/Haptics';
import { Ads } from './platform/Ads';
import { Share } from './platform/Share';
import { Leaderboard } from './platform/Leaderboard';
import { CloudSync } from './platform/CloudSync';

const { ccclass } = _decorator;

/** 与 web CONFIG.DRAG_TOUCH_BOOST_CELLS：触屏拖拽中把 ghost 上抬，越过 dock→盘面下缘距离。 */
const DRAG_TOUCH_BOOST_CELLS = 1.4;
/** 手指移动超过该像素才视为「开始拖拽」（此前 ghost 停在候选区原位）。 */
const DRAG_MOVE_THRESHOLD = 4;

/** 触摸诊断开关：排查「按钮点不动」时设 true，在 Xcode/控制台看每次触摸的坐标与命中结果。
 *  确认无误后改回 false 关闭日志。 */
const DEBUG_TOUCH = false;

/** 局末宝箱分级（对齐 web endGameChest：普通/稀有/史诗）。 */
type ChestTier = 'common' | 'rare' | 'epic';

/**
 * 落子智能吸附参数 —— 与 web/src/config.js 对齐，避免"非预期消行/清屏"：
 * 拖拽时粘滞刻意降到约 1/3（×0.35 / ×0.55），释放时粘滞归零、半径放宽到 4，
 * 让方块不会一碰到可消行格就被"粘住"，同时释放更宽容（差一点也能放成功）。
 */
const SNAP = {
    placeRadius: 2,
    releaseRadius: 4,
    clearLineBonus: 0.9,
    clearCellBonus: 0.015,
    clearAssistWindow: 1.35,
    stickyBonus: 0.32,
    stickyWindow: 0.75,
} as const;

/** 核心循环编排：连接 GameModel 与所有视图/特效/技能/元系统/存档。 */
@ccclass('GameController')
export class GameController extends Component {
    model!: GameModel;
    meta!: MetaState;
    board!: BoardView;
    lineFx!: LineClearFx;
    fx!: FxLayer;
    dock!: DockView;
    hud!: Hud;
    ghost!: Node;
    skillBar!: SkillBar;
    metaPanel!: MetaPanel;
    shakeTarget!: Node;
    bgNode!: Node;
    /** 玩家画像 / 出块上下文（喂给真实引擎；本控制器在消行/计分事件里更新）。 */
    playerCtx!: PlayerContext;

    // 玩家档案子系统（核心层，控制器负责加载/保存）
    progression = new Progression();
    achievements = new AchievementState();
    seasonPass = new SeasonPass();
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
    private _ghostIconRoot: Node | null = null;
    private _ghostIcons: Label[] = [];
    private pendingSkill: SkillId | null = null;
    private aimAssist = false;
    private timeLeft = 0;
    private settled = false;
    /** 本局开始时的历史最佳，用于结算判断是否破纪录。 */
    private prevBest = 0;
    /** 本局命中的局末宝箱（对齐 web：结算卡关闭后再弹），未命中为 null。 */
    private _pendingChest: { tier: ChestTier; coins: number } | null = null;
    private _pendingChestFirstWin = false;

    wire(parts: {
        model: GameModel;
        meta: MetaState;
        board: BoardView;
        lineFx: LineClearFx;
        fx: FxLayer;
        dock: DockView;
        hud: Hud;
        ghost: Node;
        skillBar: SkillBar;
        metaPanel: MetaPanel;
        shakeTarget: Node;
        bgNode: Node;
        playerCtx: PlayerContext;
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

        this.skillBar.setup((id) => this.onSkill(id));
        this.metaPanel.setup(this.meta, this.model.wallet, () => this.save());
        this.metaPanel.setExtra(this.progression, this.daily, this.seasonPass, this.achievements);

        // 加载玩家档案子系统
        this.progression.fromJSON(Storage.getJSON(STORAGE_KEYS.progression, null));
        this.achievements.fromJSON(Storage.getJSON(STORAGE_KEYS.achievements, null));
        this.seasonPass.fromJSON(Storage.getJSON(STORAGE_KEYS.season, null));
        this.daily.fromJSON(Storage.getJSON(STORAGE_KEYS.daily, null));
        this.stats = Storage.getJSON(STORAGE_KEYS.stats, this.stats);
        this.companion.fromJSON(Storage.getJSON(STORAGE_KEYS.companion, null));
        this.setupCompanion();

        Analytics.track(ANALYTICS_EVENTS.sessionStart, { mode: this.model.mode });
        if (flag('bgm')) AudioManager.startBgm();
        // 季节环境氛围（按当月强调色缓慢飘落柔光，营造节令感）。
        this.fx.startAmbience(seasonalAccent());
        Share.registerShareMenu(() => this.model.best);

        this.prevBest = this.model.best;
        const saved = Storage.getJSON<Record<string, unknown> | null>(STORAGE_KEYS.save, null);
        if (saved && this.model.fromJSON(saved as never) && !this.model.gameOver) {
            this.board.setSkin(this.model.skin);
            // 存档常停在「刚落下最后一块、尚未补充候选」的瞬间，恢复后候选区会是空的，
            // 此时补一批候选，避免「无候选出块」无法继续。
            this.model.ensurePlayableDock();
            // 续局：从恢复点开始录制回放（早于本局的步数已不可考，记为部分回放）。
            this.replay.begin(this.model.grid.size, this.model.mode, this.model.skin.id, this.model.best);
            this.renderAll();
        } else {
            this.startGame(this.model.mode);
        }

        this.hud.setBest(this.model.best);
        this.hud.setCoins(this.model.wallet.coins);
        this.hud.setLevel(this.progression.level);
        this.skillBar.refresh(this.model.wallet.coins);
        this.renderAll();
        console.log('[OpenBlock] GameController.start done (renderAll ok)');
        // 回归礼包等入场流程改由主菜单「开始/继续」后触发（见 enterFromMenu），
        // 避免在菜单之下先弹浮层（与 web「先菜单后入场」一致）。
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

    private startGameImpl(mode: GameMode): void {
        this.model.setMode(mode);
        Storage.set(STORAGE_KEYS.mode, mode);
        this.settled = false;
        this.prevBest = this.model.best;
        // 重置玩家画像（保留 best 作为本局 PB 基线）。
        this.playerCtx.reset(this.model.best);
        this.timeLeft = getMode(mode).timeLimitSec;
        this.hud.setTimeLeft(this.timeLeft > 0 ? this.timeLeft : null);
        this.hud.setGameOver(false);
        this.hud.resetScore();
        this.model.newGame();
        // 新开局：重置回放录制（记录本局每一步落子）。
        this.replay.begin(this.model.grid.size, mode, this.model.skin.id, this.model.best);
        this.hud.setBest(this.model.best);
        this.renderAll();
        // 持久化新开局：避免存档仍停留在上一局（含旧分/结束态），与 web 重开即落库一致。
        this.save();
    }

    update(dt: number): void {
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

    onEnable(): void {
        console.log('[OpenBlock] GameController.onEnable: registering global touch listeners');
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onDisable(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    // ---- model events ----

    private onModelEvent(e: GameEvent): void {
        try { this.onModelEventImpl(e); } catch (err) { reportFatal(`onModelEvent:${e.type}`, err); }
    }

    private onModelEventImpl(e: GameEvent): void {
        switch (e.type) {
            case 'dock':
                this.dock.render(this.model.dock, this.model.skin);
                break;
            case 'place': {
                this.fx.flashPlacement(e.shape, e.gx, e.gy, blockColor(this.model.skin, e.colorIdx));
                // 回放录制：记一帧落子（确定性重建用）。
                this.replay.record({ shape: e.shape, colorIdx: e.colorIdx, gx: e.gx, gy: e.gy });
                AudioManager.sfxPlace();
                Haptics.light();
                this.meta.recordPlace();
                this.save();
                break;
            }
            case 'score':
                this.hud.setScore(e.score);
                this.hud.setBest(this.model.best);
                this.meta.recordScore(e.score);
                // 玩家画像：里程碑感知（喂给引擎做 gapFill 加权）。
                this.playerCtx.onScore(e.score);
                break;
            case 'nearmiss':
                this.fx.flashNearMiss(e.lines);
                Haptics.light();
                break;
            case 'revive':
                this.fx.floatText(t('revive.done'), new Color(140, 255, 180, 255));
                break;
            case 'clear': {
                this.lineFx.play(e.result, this.model.skin);
                this.fx.burstClear(e.result, this.model.skin);
                if (e.reason === 'line') {
                    // 玩家画像：消行节奏（清零 roundsSinceClear、累计 totalClears，喂给引擎纾困/特殊配额）。
                    this.playerCtx.onClear(e.result.count);
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
                    this.seasonPass.addXp(e.result.count * 3);
                    this.stats.totalLines += e.result.count;
                    this.stats.maxComboLines = Math.max(this.stats.maxComboLines, e.result.count);
                    Analytics.track(ANALYTICS_EVENTS.clear, { count: e.result.count });
                    if (e.result.count >= 2) Analytics.track(ANALYTICS_EVENTS.multiClear, { count: e.result.count });
                }
                if (e.perfectClear) {
                    AudioManager.sfxPerfect();
                    this.fx.floatText(t('hud.perfect'), new Color(255, 220, 120, 255));
                    ScreenShake.shake(this.shakeTarget, 18, 0.4);
                    Haptics.heavy();
                    this.stats.perfectClears++;
                    Analytics.track(ANALYTICS_EVENTS.perfectClear, {});
                } else if (e.reason === 'line') {
                    AudioManager.sfxClear(e.result.count);
                    const lines = e.result.count;
                    if (lines >= 2) {
                        this.fx.floatText(t('hud.combo', { n: lines }), new Color(120, 220, 255, 255));
                        AudioManager.sfxCombo(lines);
                        ScreenShake.shake(this.shakeTarget, 8 + lines * 2, 0.3);
                        Analytics.track(ANALYTICS_EVENTS.comboHigh, { count: lines });
                    }
                    Haptics.medium();
                }
                this.save();
                break;
            }
            case 'wallet':
                this.hud.setCoins(e.coins);
                this.skillBar.refresh(e.coins);
                this.save();
                break;
            case 'freeze':
                if (e.active) this.fx.floatText('❄️ 冻结', new Color(160, 220, 255, 255));
                if (e.used) this.fx.floatText('❄️ 触发冻结', new Color(160, 220, 255, 255));
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
        AudioManager.sfxGameOver();
        Storage.setNumber(STORAGE_KEYS.best, this.model.best);
        Analytics.track(ANALYTICS_EVENTS.gameOver, { score: this.model.score, mode: this.model.mode });
        Leaderboard.submit(this.model.best);
        this.save();

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
                    onClick: () => void Ads.rewarded(cfg.adUnitIds.revive || 'revive').then((ok) => { if (ok) this.doRevive(); else this.settle(); }),
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
        const xpGain = Math.floor(score / 10) + 5;
        const lvRes = this.progression.addXp(xpGain);
        this.seasonPass.addXp(Math.floor(score / 8) + 5);
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
        if (achReward > 0) this.model.wallet.earn(achReward);

        const firstWin = score > 0 && this.daily.consumeFirstWin();
        // 保存本局回放（无落子则不存）。
        ReplayStore.save(this.replay.finish(score));
        this.save();

        // 局末宝箱：先掷出结果（含概率/保底/分级）并暂存，对齐 web —— 先弹「结算卡」，
        // 玩家点「再来一局」离开后再把命中的宝箱弹到新一局之上；未命中则只有结算卡。
        this._pendingChest = flag('rewards') ? this.rollChest(score) : null;
        this._pendingChestFirstWin = firstWin;
        this.showGameOverPanel(xpGain);
    }

    /**
     * 局末宝箱掷点（对齐 web `endGameChest`）：基础 5%，本局得分 ≥800 再 +5%，
     * 连续 12 局未出则保底必出；命中后按 70/25/5 抽普通/稀有/史诗并折算金币（史诗×3 / 稀有×2）。
     * 状态（连续未出局数 / 累计宝箱数）落 Storage，保证保底跨局生效。
     */
    private rollChest(score: number): { tier: ChestTier; coins: number } | null {
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
        const mult = tier === 'epic' ? 3 : tier === 'rare' ? 2 : 1;
        const coins = openChest(score) * mult;
        Storage.setJSON(STORAGE_KEYS.chest, { since: 0, total: (st.total ?? 0) + 1 });
        return { tier, coins };
    }

    private pickTier(): ChestTier {
        const r = Math.random() * 100;
        if (r < 70) return 'common';
        if (r < 95) return 'rare';
        return 'epic';
    }

    /**
     * 结算卡（对齐 web `.game-over-card`）：大号本局得分 + 最佳/破纪录 + 本局经验，
     * 主 CTA「再来一局」、次级「分享」。背景/卡片任意处点按亦重开（与 web「点击重开」一致），
     * 分享按钮返回 false 不关卡。
     */
    private showGameOverPanel(xpGain: number): void {
        const score = this.model.score;
        const newBest = score > this.prevBest && score > 0;
        const lines = [t('hud.best', { n: this.model.best })];
        if (xpGain > 0) lines.push(t('gameover.xp', { n: xpGain }));
        if (newBest) lines.push(t('gameover.newbest'));
        ModalPanel.show(this.node, {
            title: t('gameover.title'),
            bigValue: `${score}`,
            lines,
            dismissable: true,
            noCloseX: true,
            onClose: () => this.restartFromGameOver(),
            buttons: [
                { label: t('btn.again'), primary: true, onClick: () => { /* 关闭即经 onClose 重开 */ } },
                { label: t('btn.share'), color: new Color(74, 80, 100, 255), onClick: () => { this.doShare(); return false; } },
            ],
        });
    }

    /** 离开结算卡：开新局后，若本局命中了宝箱，则把宝箱弹到新一局之上（对齐 web 顺序）。 */
    private restartFromGameOver(): void {
        const chest = this._pendingChest;
        this._pendingChest = null;
        this.startGame(this.model.mode);
        if (chest) this.showChest(chest, this._pendingChestFirstWin);
    }

    /** 分级宝箱卡（对齐 web `.chest-card`）：图标 + 「{级别}宝箱」+ 金币奖励，点按钮或空白处领取入账。 */
    private showChest(chest: { tier: ChestTier; coins: number }, firstWin: boolean): void {
        const reward = firstWin ? Math.round(chest.coins * this.daily.firstWinMultiplier()) : chest.coins;
        const icon = chest.tier === 'epic' ? '🏆' : chest.tier === 'rare' ? '🎀' : '🎁';
        const lines = [t('chest.reward', { n: reward })];
        if (firstWin) lines.push(t('daily.firstwin', { n: this.daily.firstWinMultiplier() }));
        let granted = false;
        const grant = (): void => { if (!granted) { granted = true; this.model.wallet.earn(reward); } };
        ModalPanel.show(this.node, {
            title: `${icon} ${t(`chest.${chest.tier}`)}`,
            lines,
            dismissable: true,
            buttons: [{ label: t('chest.claim'), primary: true, color: new Color(70, 130, 90, 255), onClick: () => { /* 入账在 onClose 统一处理 */ } }],
            // 点按钮或点空白关闭都入账，避免漏发（与 web pendingChest 一致）。
            onClose: grant,
        });
    }

    private todayKey(): string {
        return new Date().toISOString().slice(0, 10);
    }

    /** 创建屏上伙伴（挂在 HUD 左侧、按钮行与 HUD 之间的空白区）。 */
    private setupCompanion(): void {
        const n = new Node('Companion');
        n.parent = this.hud.node;
        n.setPosition(-250, 62, 0);
        const cv = n.addComponent(CompanionView);
        cv.setup(() => this.openCompanionPanel());
        cv.setSkin(this.model.skin.id, this.companion.level());
        this.companionView = cv;
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
            rewards: cfg.wheelRewards,
            spin: () => spinWheel(),
            onReward: (coins) => this.model.wallet.earn(coins),
            adSpin: () => Ads.rewarded(cfg.adUnitIds.wheel || 'wheel'),
        });
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

    doShare(): void {
        if (!flag('share')) return;
        Share.shareScore(this.model.best);
    }

    showLeaderboard(): void {
        if (!flag('leaderboard')) return;
        const top = Leaderboard.top(10);
        const lines = top.length
            ? top.map((e, i) => `${i + 1}. ${e.you ? t('rank.you') : e.name}  ${e.score}`)
            : ['—'];
        ModalPanel.show(this.node, {
            title: t('rank.title'),
            lines,
            buttons: [{ label: t('btn.close'), color: new Color(74, 80, 100, 255), onClick: () => { /* close */ } }],
            dismissable: true,
        });
    }

    toggleSound(): boolean {
        const on = AudioManager.toggleBgm();
        Storage.set(STORAGE_KEYS.sound, on ? '1' : '0');
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

    private onSkill(id: SkillId): void {
        const def = SKILLS[id];
        if (this.model.gameOver) return;
        if (!this.model.wallet.canAfford(def.cost)) {
            AudioManager.sfxInvalid();
            return;
        }
        AudioManager.sfxSkill();
        switch (id) {
            case 'hint': {
                const hint = findHint(this.model.grid, this.model.dock);
                if (!hint) { AudioManager.sfxInvalid(); return; }
                this.model.wallet.spend(def.cost);
                const b = this.model.dock[hint.index];
                this.board.render(this.model.grid, this.model.skin);
                this.board.renderGhost(this.model.grid, this.model.skin, b.shape, hint.gx, hint.gy, b.colorIdx);
                this.scheduleOnce(() => this.board.render(this.model.grid, this.model.skin), 1.1);
                break;
            }
            case 'undo': {
                if (this.model.undo()) {
                    this.model.wallet.spend(def.cost);
                    this.renderAll();
                } else {
                    AudioManager.sfxInvalid();
                }
                break;
            }
            case 'bomb': {
                this.pendingSkill = this.pendingSkill === 'bomb' ? null : 'bomb';
                this.skillBar.setActive(this.pendingSkill);
                if (this.pendingSkill) this.fx.floatText(t('skill.bombHint'), new Color(255, 160, 120, 255), -120);
                break;
            }
            case 'rainbow': {
                const n = this.model.rainbowClear();
                if (n > 0) { this.model.wallet.spend(def.cost); this.renderAll(); }
                else AudioManager.sfxInvalid();
                break;
            }
            case 'freeze': {
                this.model.wallet.spend(def.cost);
                this.model.setFreeze(true);
                break;
            }
            case 'reroll': {
                this.model.wallet.spend(def.cost);
                this.model.reroll();
                this.renderAll();
                break;
            }
            case 'preview': {
                const spots = listBestPlacements(this.model.grid, this.model.dock);
                if (spots.length === 0) { AudioManager.sfxInvalid(); return; }
                this.model.wallet.spend(def.cost);
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
        this.skillBar.refresh(this.model.wallet.coins);
    }

    // ---- input ----

    /** 供 Bootstrap 在 start 阶段兜底转发触摸（确保场景就绪后 TapBus 可响应）。 */
    dispatchTap(e: EventTouch): boolean {
        const ui = e.getUILocation();
        const loc = e.getLocation();
        const hit = TapBus.hit(loc.x, loc.y, ui.x, ui.y);
        if (hit) console.log(`[OpenBlock] tap ok ui=(${ui.x | 0},${ui.y | 0})`);
        return hit;
    }

    private onTouchStart(e: EventTouch): void {
        const loc = e.getLocation();
        // 模态（主菜单/弹窗）：优先 TapBus，START/END 双阶段都尝试（原生 Button 常在 END 才触发）。
        if (Modal.isOpen()) {
            this.dispatchTap(e);
            return;
        }
        if (this.metaPanel.node.active) return;

        if (this.model.gameOver) {
            if (this.dispatchTap(e)) return;
            this.startGame(this.model.mode);
            return;
        }

        // 炸弹待引爆：点击盘面
        if (this.pendingSkill === 'bomb') {
            const bl = screenToLocal(this.board.node, loc.x, loc.y);
            const cell = this.board.localToCell(bl.x, bl.y);
            this.pendingSkill = null;
            this.skillBar.setActive(null);
            if (cell) {
                const n = this.model.bombArea(cell.gx, cell.gy, 1);
                if (n > 0) { this.model.wallet.spend(SKILLS.bomb.cost); this.renderAll(); }
                else AudioManager.sfxInvalid();
            }
            this.skillBar.refresh(this.model.wallet.coins);
            return;
        }

        // 全局 input 兜底：与槽位 touchstart 同逻辑（web shape 格命中，非整槽矩形）。
        const pick = this.dock.pickBlock(loc.x, loc.y);
        if (pick >= 0) {
            this.beginDockDrag(pick, e);
            return;
        }

        if (this.dispatchTap(e)) return;
    }

    /**
     * 从候选区起手拖拽（对齐 web `startDrag`）。
     * 由 DockView 槽位 touchstart 或全局 pickBlock 触发。
     */
    private beginDockDrag(index: number, e: EventTouch): void {
        if (this.dragIndex >= 0) return;
        if (Modal.isOpen() || this.metaPanel.node.active || this.model.gameOver) return;
        const block = this.model.dock[index];
        if (!block || block.placed) return;

        const loc = e.getLocation();
        this.dragStartScreenX = loc.x;
        this.dragStartScreenY = loc.y;
        this.dragMoved = false;
        this.dragIndex = index;
        this.dragShape = block.shape;
        this.dragColor = block.colorIdx;
        this.snap = null;
        this.drawGhost();
        // 原地激活：ghost 叠在候选块原位，不跟手指跳（对齐 web 抓起后相对位移跟手）。
        this.placeGhostAtDock(index);
        this.dock.setDraggingSlot(index);
        this.ghost.setSiblingIndex(this.node.children.length - 1);
        if (DEBUG_TOUCH) {
            console.log(`[OpenBlock] dock activate slot=${index} (in-place)`);
        }
    }

    private onTouchMove(e: EventTouch): void {
        if (this.dragIndex < 0) return;
        this.moveGhost(e);
        if (this.dragMoved) this.updateSnap(e);
    }

    private onTouchEnd(e: EventTouch): void {
        if (this.dragIndex < 0 && this.dispatchTap(e)) return;
        if (this.dragIndex < 0) return;
        // 仅激活未拖动：松手取消，块回候选区。
        if (!this.dragMoved) {
            this.cancelDrag();
            return;
        }
        // 释放时用更宽容的 release 参数重新吸附一次（半径 4、零粘滞），挽救"差一点"的释放。
        this.updateSnap(e, true);
        const idx = this.dragIndex;
        const snap = this.snap;
        this.cancelDrag();
        if (snap && this.model.canPlaceBlock(idx, snap.gx, snap.gy)) {
            this.model.placeAt(idx, snap.gx, snap.gy);
        } else {
            AudioManager.sfxInvalid();
        }
        this.board.render(this.model.grid, this.model.skin);
        this.dock.render(this.model.dock, this.model.skin);
    }

    private updateSnap(e: EventTouch, release = false): void {
        if (!this.dragShape) return;
        const loc = e.getLocation();
        const bl = screenToLocal(this.board.node, loc.x, loc.y);
        bl.y += this.dragLiftPx();
        const cell = this.board.cellSize;
        const half = this.board.boardPx / 2;
        const fx = (bl.x + half) / cell;
        const fy = (half - bl.y) / cell;
        const sw = this.dragShape[0].length;
        const sh = this.dragShape.length;
        const anchorX = Math.round(fx - sw / 2);
        const anchorY = Math.round(fy - sh / 2);
        const prev = this.snap ? { x: this.snap.gx, y: this.snap.gy } : null;
        // 与 web 对齐：拖拽用 placeRadius + 降权粘滞；释放用 releaseRadius + 零粘滞（更宽容）。
        // 瞄准辅助开启时拖拽半径 +1，扩大消行吸附搜索范围。
        const radius = release
            ? SNAP.releaseRadius
            : SNAP.placeRadius + (this.aimAssist ? 1 : 0);
        const best = this.model.grid.pickSmartHoverPlacement(
            this.dragShape, fx, fy, anchorX, anchorY, radius,
            {
                colorIdx: this.dragColor,
                previous: prev,
                clearLineBonus: SNAP.clearLineBonus,
                clearCellBonus: SNAP.clearCellBonus,
                clearAssistWindow: SNAP.clearAssistWindow,
                stickyBonus: release ? 0 : SNAP.stickyBonus * 0.35,
                stickyWindow: release ? 0 : SNAP.stickyWindow * 0.55,
            },
        );
        this.snap = best ? { gx: best.x, gy: best.y } : null;
        this.board.render(this.model.grid, this.model.skin);
        if (this.snap) {
            this.board.renderGhost(
                this.model.grid, this.model.skin, this.dragShape, this.snap.gx, this.snap.gy, this.dragColor,
            );
        }
    }

    private drawGhost(): void {
        const g = this.ghost.getComponent(Graphics) || this.ghost.addComponent(Graphics);
        g.clear();
        if (!this.dragShape) return;
        const skin = this.model.skin;
        const cell = this.board.cellSize;
        const { inset, radius } = blockMetrics(skin, cell);
        const sw = this.dragShape[0].length;
        const sh = this.dragShape.length;
        const left = -(sw * cell) / 2;
        const top = (sh * cell) / 2;

        const uit = this.ghost.getComponent(UITransform) || this.ghost.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        uit.setContentSize(sw * cell, sh * cell);

        if (!this._ghostIconRoot) {
            this._ghostIconRoot = new Node('ghostIcons');
            this._ghostIconRoot.parent = this.ghost;
            this._ghostIconRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        }

        let iconN = 0;
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                if (!this.dragShape[y][x]) continue;
                const cellX = left + x * cell;
                const cellY = top - (y + 1) * cell;
                const fsize = cell - inset * 2;
                paintBlockFace(g, cellX + inset, cellY + inset, fsize, radius, skin, this.dragColor, 230);
                const em = blockIcon(skin, this.dragColor);
                const fs = em ? iconFontSize(fsize) : 0;
                if (em && fs > 0) {
                    let l = this._ghostIcons[iconN];
                    if (!l) {
                        const n = new Node('gic');
                        n.parent = this._ghostIconRoot!;
                        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
                        l = n.addComponent(Label);
                        l.color = new Color(255, 255, 255, 255);
                        this._ghostIcons[iconN] = l;
                    }
                    l.node.active = true;
                    l.node.setPosition(cellX + cell / 2, cellY + cell / 2, 0);
                    l.fontSize = fs;
                    l.lineHeight = fs;
                    l.string = em;
                    iconN++;
                }
            }
        }
        for (let i = iconN; i < this._ghostIcons.length; i++) {
            if (this._ghostIcons[i]) this._ghostIcons[i].node.active = false;
        }
    }

    /** ghost 锚在候选槽中心（父节点局部坐标）。 */
    private placeGhostAtDock(index: number): void {
        const dockPos = this.dock.node.position;
        this.dragOriginX = dockPos.x + this.dock.slotCenterX(index);
        this.dragOriginY = dockPos.y;
        this.ghost.setPosition(this.dragOriginX, this.dragOriginY, 0);
    }

    /** 触屏 ghost 上抬量（对齐 web `_touchDragLiftPx`：仅拖拽中生效）。 */
    private dragLiftPx(): number {
        if (!this.dragShape || !this.dragMoved) return 0;
        const cell = this.board.cellSize;
        const blockHalf = (this.dragShape.length * cell) / 2;
        const boost = DRAG_TOUCH_BOOST_CELLS * cell;
        return blockHalf + boost;
    }

    /**
     * 跟手位移（对齐 web 触屏 `sx + (x-sx)*track + offset - lift`）：
     * 激活时停在原位，手指移动后按相对抓取点位移。
     */
    private moveGhost(e: EventTouch): void {
        const loc = e.getLocation();
        const dist = Math.hypot(loc.x - this.dragStartScreenX, loc.y - this.dragStartScreenY);
        if (dist >= DRAG_MOVE_THRESHOLD) this.dragMoved = true;

        const parent = this.ghost.parent || this.ghost;
        const startL = screenToLocal(parent, this.dragStartScreenX, this.dragStartScreenY);
        const curL = screenToLocal(parent, loc.x, loc.y);
        const lift = this.dragLiftPx();
        this.ghost.setPosition(
            this.dragOriginX + (curL.x - startL.x),
            this.dragOriginY + (curL.y - startL.y) + lift,
            0,
        );
    }

    private cancelDrag(): void {
        this.dock.clearDraggingSlot();
        this.dragIndex = -1;
        this.dragShape = null;
        this.snap = null;
        this.dragMoved = false;
        const g = this.ghost.getComponent(Graphics);
        if (g) g.clear();
        for (const l of this._ghostIcons) if (l?.node) l.node.active = false;
        this.board.render(this.model.grid, this.model.skin);
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
        const next = getSkin(id);
        playSkinTransition(this.node, next, () => this.applySkinImmediate(id));
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
        this.renderAll();
        this.companionView?.setSkin(this.model.skin.id, this.companion.level());
        Storage.set(STORAGE_KEYS.skin, this.model.skin.id);
        this.save();
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
        Storage.setJSON(STORAGE_KEYS.daily, this.daily.toJSON());
        Storage.setJSON(STORAGE_KEYS.stats, this.stats);
        Storage.setJSON(STORAGE_KEYS.companion, this.companion.toJSON());
        if (flag('cloudSave')) {
            CloudSync.push({ best: this.model.best, coins: this.model.wallet.coins, save: this.model.toJSON(), ts: Date.now() });
        }
    }
}
