import { _decorator, Component, Node, Graphics, UITransform, Vec3, Color, input, Input, EventTouch } from 'cc';
import {
    GameModel, GameEvent, ShapeMatrix, MetaState, findHint, listBestPlacements, SKILLS, SkillId,
    Progression, AchievementState, SeasonPass, DailyState, listSkinIds, t,
    getConfig, flag, Analytics, ANALYTICS_EVENTS, openChest, spinWheel, GameMode, MODE_ORDER, getMode,
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
import { Modal, TapBus } from './ui/uiKit';
import { blockColor, bgColor } from './skin/palette';
import { Storage, STORAGE_KEYS } from './platform/Storage';
import { AudioManager } from './audio/AudioManager';
import { Haptics } from './platform/Haptics';
import { Ads } from './platform/Ads';
import { Share } from './platform/Share';
import { Leaderboard } from './platform/Leaderboard';
import { CloudSync } from './platform/CloudSync';

const { ccclass } = _decorator;

const GHOST_LIFT = 70;

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

    // 玩家档案子系统（核心层，控制器负责加载/保存）
    progression = new Progression();
    achievements = new AchievementState();
    seasonPass = new SeasonPass();
    daily = new DailyState();

    // 累计统计（成就判定用）
    private stats = { totalGames: 0, totalLines: 0, maxComboLines: 0, perfectClears: 0 };

    private dragIndex = -1;
    private dragShape: ShapeMatrix | null = null;
    private dragColor = 0;
    private snap: { gx: number; gy: number } | null = null;
    private pendingSkill: SkillId | null = null;
    private aimAssist = false;
    private timeLeft = 0;
    private settled = false;
    /** 本局开始时的历史最佳，用于结算判断是否破纪录。 */
    private prevBest = 0;

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
    }): void {
        Object.assign(this, parts);
    }

    start(): void {
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

        Analytics.track(ANALYTICS_EVENTS.sessionStart, { mode: this.model.mode });
        if (flag('bgm')) AudioManager.startBgm();
        Share.registerShareMenu(() => this.model.best);

        this.prevBest = this.model.best;
        const saved = Storage.getJSON<Record<string, unknown> | null>(STORAGE_KEYS.save, null);
        if (saved && this.model.fromJSON(saved as never) && !this.model.gameOver) {
            this.board.setSkin(this.model.skin);
            // 存档常停在「刚落下最后一块、尚未补充候选」的瞬间，恢复后候选区会是空的，
            // 此时补一批候选，避免「无候选出块」无法继续。
            this.model.ensurePlayableDock();
            this.renderAll();
        } else {
            this.startGame(this.model.mode);
        }

        this.hud.setBest(this.model.best);
        this.hud.setCoins(this.model.wallet.coins);
        this.hud.setLevel(this.progression.level);
        this.skillBar.refresh(this.model.wallet.coins);
        this.renderAll();
        this.maybeWelcomeBack();
    }

    /** 用指定模式开新局（重置计时）。 */
    startGame(mode: GameMode): void {
        this.model.setMode(mode);
        Storage.set(STORAGE_KEYS.mode, mode);
        this.settled = false;
        this.prevBest = this.model.best;
        this.timeLeft = getMode(mode).timeLimitSec;
        this.hud.setTimeLeft(this.timeLeft > 0 ? this.timeLeft : null);
        this.hud.setGameOver(false);
        this.hud.resetScore();
        this.model.newGame();
        this.renderAll();
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
        switch (e.type) {
            case 'dock':
                this.dock.render(this.model.dock, this.model.skin);
                break;
            case 'place': {
                this.fx.flashPlacement(e.shape, e.gx, e.gy, blockColor(this.model.skin, e.colorIdx));
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
        this.save();

        // 结算先弹宝箱（若开启），宝箱关闭后再弹「结算卡 + 再来一局」，避免双弹窗割裂；
        // 无宝箱则直接弹结算卡。对齐 web 的局后结算流程。
        if (flag('rewards')) this.showChest(firstWin);
        else this.showGameOverPanel();
    }

    /** 结算卡：展示本局得分 / 最佳（破纪录提示），并提供「再来一局」。 */
    private showGameOverPanel(): void {
        const score = this.model.score;
        const newBest = score > this.prevBest && score > 0;
        const lines = [t('hud.score', { n: score }), t('hud.best', { n: this.model.best })];
        if (newBest) lines.push(t('gameover.newbest'));
        ModalPanel.show(this.node, {
            title: t('gameover.title'),
            lines,
            buttons: [
                {
                    label: t('btn.again'),
                    primary: true,
                    onClick: () => this.startGame(this.model.mode),
                },
            ],
        });
    }

    private showChest(firstWin: boolean): void {
        const base = openChest(this.model.score);
        const coins = firstWin ? base * this.daily.firstWinMultiplier() : base;
        const cfg = getConfig();
        const lines = [t('chest.reward', { n: coins })];
        if (firstWin) lines.push(t('daily.firstwin', { n: this.daily.firstWinMultiplier() }));
        ModalPanel.show(this.node, {
            title: t('chest.title'),
            lines,
            buttons: [
                { label: t('chest.open'), primary: true, color: new Color(70, 130, 90, 255), onClick: () => this.model.wallet.earn(coins) },
                {
                    label: t('chest.adDouble'),
                    color: new Color(120, 90, 60, 255),
                    onClick: () => void Ads.rewarded(cfg.adUnitIds.doubleChest || 'doubleChest').then((ok) => this.model.wallet.earn(ok ? coins * 2 : coins)),
                },
            ],
            // 宝箱关闭后进入结算卡（再来一局）。
            onClose: () => this.showGameOverPanel(),
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

    private maybeWelcomeBack(): void {
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
                });
            }
        }
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

    private uiToLocal(node: Node, uiX: number, uiY: number): Vec3 {
        return node.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(uiX, uiY, 0));
    }

    private onTouchStart(e: EventTouch): void {
        const ui = e.getUILocation();
        // UI 按钮统一走全局命中（原生端 node 级触摸不可靠）：顶栏按钮 / 技能栏 / 弹窗 / 引导等。
        if (TapBus.hit(ui.x, ui.y)) return;
        if (Modal.isOpen()) return;
        if (this.metaPanel.node.active) return;

        if (this.model.gameOver) {
            this.startGame(this.model.mode);
            return;
        }

        // 炸弹待引爆：点击盘面
        if (this.pendingSkill === 'bomb') {
            const bl = this.uiToLocal(this.board.node, ui.x, ui.y);
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

        const dl = this.uiToLocal(this.dock.node, ui.x, ui.y);
        const dockUit = this.dock.node.getComponent(UITransform)!;
        // 候选区命中放宽：纵向给足容差（候选区是底部唯一可拖拽源，且拖拽起手后 ghost 跟随手指），
        // 横向留一个 cell 余量，避免因布局换算的微小偏差导致整排候选块点不动。
        const yTol = Math.max(dockUit.height / 2, 170);
        const halfW = dockUit.width / 2 + this.dock.cell;
        if (Math.abs(dl.y) > yTol || Math.abs(dl.x) > halfW) return;
        const slot = this.dock.hitSlot(dl.x);
        if (slot < 0) return;
        const block = this.model.dock[slot];
        if (!block || block.placed) return;

        this.dragIndex = slot;
        this.dragShape = block.shape;
        this.dragColor = block.colorIdx;
        this.snap = null;
        this.drawGhost();
        this.moveGhost(ui.x, ui.y);
        this.updateSnap(ui.x, ui.y);
    }

    private onTouchMove(e: EventTouch): void {
        if (this.dragIndex < 0) return;
        const ui = e.getUILocation();
        this.moveGhost(ui.x, ui.y);
        this.updateSnap(ui.x, ui.y);
    }

    private onTouchEnd(e: EventTouch): void {
        if (this.dragIndex < 0) return;
        // 释放时用更宽容的 release 参数重新吸附一次（半径 4、零粘滞），挽救"差一点"的释放。
        const ui = e.getUILocation();
        this.updateSnap(ui.x, ui.y, true);
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

    private updateSnap(uiX: number, uiY: number, release = false): void {
        if (!this.dragShape) return;
        const bl = this.uiToLocal(this.board.node, uiX, uiY + GHOST_LIFT);
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
        const cell = this.board.cellSize;
        const inner = cell - 2;
        const sw = this.dragShape[0].length;
        const sh = this.dragShape.length;
        const left = -(sw * cell) / 2;
        const top = (sh * cell) / 2;
        const col = blockColor(this.model.skin, this.dragColor, 220);
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                if (!this.dragShape[y][x]) continue;
                const px = left + x * cell + 1;
                const py = top - (y + 1) * cell + 1;
                g.fillColor = col;
                g.roundRect(px, py, inner, inner, Math.min(6, inner * 0.18));
                g.fill();
            }
        }
    }

    private moveGhost(uiX: number, uiY: number): void {
        this.ghost.setWorldPosition(new Vec3(uiX, uiY + GHOST_LIFT, 0));
    }

    private cancelDrag(): void {
        this.dragIndex = -1;
        this.dragShape = null;
        this.snap = null;
        const g = this.ghost.getComponent(Graphics);
        if (g) g.clear();
    }

    // ---- skin + save ----

    /** 打开皮肤选择面板（对齐 web 的皮肤列表选择器；点选即应用并持久化）。 */
    openSkinPanel(): void {
        SkinPanel.show(this.node, this.model.skin.id, (id) => this.applySkin(id));
    }

    /** 应用指定皮肤：刷新盘面/候选区/背景并持久化（换肤效果与 web 一致）。 */
    applySkin(id: string): void {
        if (id === this.model.skin.id) return;
        this.model.setSkin(id);
        this.board.setSkin(this.model.skin);
        const g = this.bgNode.getComponent(Graphics);
        if (g) {
            g.clear();
            g.fillColor = bgColor(this.model.skin);
            g.rect(-1000, -1500, 2000, 3000);
            g.fill();
        }
        this.renderAll();
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
        if (flag('cloudSave')) {
            CloudSync.push({ best: this.model.best, coins: this.model.wallet.coins, save: this.model.toJSON(), ts: Date.now() });
        }
    }
}
