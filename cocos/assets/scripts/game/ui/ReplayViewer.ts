import { _decorator, Component, Node, Color, UITransform } from 'cc';
import { ReplayData, Grid, getSkin, t } from '../../core';
import { BoardView } from '../BoardView';
import { Modal, dimBg, label, button, closeX, TapBus, PillButton } from './uiKit';

const { ccclass } = _decorator;

/** 每步自动播放间隔（秒）。 */
const STEP_INTERVAL = 0.45;

/**
 * 回放回看器（对齐 web replay 回看）：用引擎无关的 Grid 逐帧确定性重建盘面 + BoardView 渲染，
 * 提供 上一步 / 播放·暂停 / 下一步 控制与进度。全屏模态，背景或 × 关闭。
 */
@ccclass('ReplayViewer')
export class ReplayViewer extends Component {
    private data!: ReplayData;
    private board!: BoardView;
    private stepLabel!: ReturnType<typeof label>;
    private playBtn!: PillButton;
    private step = 0;
    private playing = false;
    private _unregDim: (() => void) | null = null;
    private _unregClose: (() => void) | null = null;

    static show(parent: Node, data: ReplayData): ReplayViewer {
        const root = new Node('ReplayViewer');
        root.parent = parent;
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const v = root.addComponent(ReplayViewer);
        v.build(data);
        return v;
    }

    private build(data: ReplayData): void {
        Modal.open();
        this.data = data;

        const dim = dimBg(this.node, 2000, 3000, 220);
        this._unregDim = TapBus.add(dim, () => this.close());

        const skin = getSkin(data.skinId);
        label(this.node, t('replay.title'), 36, 0, 470, new Color(255, 220, 130, 255));

        const boardNode = new Node('rvBoard');
        boardNode.parent = this.node;
        boardNode.setPosition(0, 70, 0);
        this.board = boardNode.addComponent(BoardView);
        this.board.boardPx = 460;
        this.board.setSkin(skin);

        this.stepLabel = label(this.node, '', 24, 0, -210, new Color(220, 228, 240, 255));

        // 控制行：上一步 / 播放·暂停 / 下一步。
        button(this.node, t('replay.prev'), -210, -290, 22, () => { this.pause(); this.setStep(this.step - 1); }, new Color(58, 66, 86, 255), { minWidth: 150 });
        this.playBtn = button(this.node, t('replay.play'), 0, -290, 24, () => this.togglePlay(), new Color(45, 120, 210, 255), { primary: true, minWidth: 160 });
        button(this.node, t('replay.next'), 210, -290, 22, () => { this.pause(); this.setStep(this.step + 1); }, new Color(58, 66, 86, 255), { minWidth: 150 });

        this._unregClose = closeX(this.node, 300, 470, () => this.close());

        // 延后首帧渲染，确保 BoardView.onLoad（建图层）已执行。
        this.scheduleOnce(() => this.setStep(0), 0);
    }

    /** 用 Grid 逐帧确定性重建到第 step 步后的盘面。 */
    private gridAt(step: number): Grid {
        const g = new Grid(this.data.size);
        const icons = getSkin(this.data.skinId).blockIcons;
        const n = Math.max(0, Math.min(step, this.data.moves.length));
        for (let i = 0; i < n; i++) {
            const m = this.data.moves[i];
            if (g.canPlace(m.shape, m.gx, m.gy)) {
                g.place(m.shape, m.colorIdx, m.gx, m.gy);
                g.checkLines(icons);
            }
        }
        return g;
    }

    private setStep(step: number): void {
        const total = this.data.moves.length;
        this.step = Math.max(0, Math.min(step, total));
        const skin = getSkin(this.data.skinId);
        this.board.render(this.gridAt(this.step), skin);
        this.stepLabel.string = t('replay.step', { cur: this.step, total, score: this.data.score });
        if (this.step >= total) this.pause();
    }

    private togglePlay(): void {
        if (this.playing) { this.pause(); return; }
        // 末尾再点播放 → 从头开始。
        if (this.step >= this.data.moves.length) this.setStep(0);
        this.playing = true;
        this.playBtn.setText(t('replay.pause'));
        this.schedule(this.tick, STEP_INTERVAL);
    }

    private pause(): void {
        if (!this.playing) return;
        this.playing = false;
        this.playBtn.setText(t('replay.play'));
        this.unschedule(this.tick);
    }

    private tick = (): void => {
        if (this.step >= this.data.moves.length) { this.pause(); return; }
        this.setStep(this.step + 1);
    };

    close(): void {
        this.pause();
        Modal.close();
        if (this._unregDim) { this._unregDim(); this._unregDim = null; }
        if (this._unregClose) { this._unregClose(); this._unregClose = null; }
        this.node.destroy();
    }
}
