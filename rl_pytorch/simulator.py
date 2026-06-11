"""与 web/src/bot/simulator.js 对齐的无头对局（v6：numpy 加速 + 精简奖励 + 直接监督信号）。"""

from __future__ import annotations

import contextlib
import copy
import os

import numpy as np

from .game_rules import CLEAR_SCORING, FEATURE_ENCODING, RL_REWARD_SHAPING, WIN_SCORE_THRESHOLD, rl_bonus_block_icons, strategy_python
from .block_spawn import generate_blocks_for_grid, generate_dock_shapes
from .grid import Grid
from .dock_color_bias import mono_near_full_line_color_weights, pick_three_dock_colors
from .player_profile_lite import PlayerProfileLite
from .shapes_data import get_all_shapes, shape_category
from .spawn_step_difficulty import spawn_step_difficulty_features
from . import fast_grid as _fg
from . import spawn_online as _spawn_online

__all__ = ["OpenBlockSimulator", "board_potential", "generate_blocks_for_grid", "generate_dock_shapes"]

_BOARD_POT_NORM = 30.0   # board_potential 归一化分母
_SURVIVAL_NORM  = 30.0   # 生存步数归一化分母
_RL_BONUS_ICONS: list[str] | None = rl_bonus_block_icons()

_POT_CFG = dict((RL_REWARD_SHAPING.get("potentialShaping") or {}))
_POT_ENABLED = bool(_POT_CFG.get("enabled", False))
_POT_COEF = float(_POT_CFG.get("coef", 0.5))
_POT_W_HOLE = float(_POT_CFG.get("holeWeight", -0.4))
_POT_W_TRANS = float(_POT_CFG.get("transitionWeight", -0.08))
_POT_W_WELL = float(_POT_CFG.get("wellWeight", -0.15))
_POT_W_CLOSE = float(_POT_CFG.get("closeToFullWeight", 0.35))
_POT_W_MOB = float(_POT_CFG.get("mobilityWeight", 0.12))
# 吸附/贴合约束：暴露边惩罚权重（负值，|值|越大越鼓励落子贴边/贴块）。
_POT_W_ADHESION = float(_POT_CFG.get("adhesionWeight", -0.12))
_ACTION_NORM = dict(FEATURE_ENCODING.get("actionNorm") or {})

# v12 评估反馈塑形（势函数项，Ng 1999 不改变最优策略）
_EVAL_FB_CFG = dict((RL_REWARD_SHAPING.get("evalFeedbackShaping") or {}))
_EVAL_FB_ENABLED = bool(_EVAL_FB_CFG.get("enabled", False))
_EVAL_FB_COEF = float(_EVAL_FB_CFG.get("coef", 0.6))
_EVAL_W_REG = float(_EVAL_FB_CFG.get("regretWeight", -0.10))
_EVAL_W_OPT = float(_EVAL_FB_CFG.get("optimalityWeight", 0.05))
_EVAL_W_FB = float(_EVAL_FB_CFG.get("forcedBadWeight", -0.08))
_EVAL_W_SV = float(_EVAL_FB_CFG.get("salvageWeight", 0.04))
_EVAL_REGRET_NORM = max(1e-3, float(_EVAL_FB_CFG.get("regretNorm", 8.0)))

# v12 难度桶课程
from .game_rules import _DATA as _RULES_DATA
_DIFF_CURR_CFG = dict(((_RULES_DATA.get("rlCurriculum") or {}).get("difficultyBucket") or {}))
_DIFF_CURR_ENABLED_CFG = bool(_DIFF_CURR_CFG.get("enabled", False))
_DIFF_CURR_STAGES = list(_DIFF_CURR_CFG.get("stages") or [])
_DIFF_CURR_RETRY_CAP = max(1, int(_DIFF_CURR_CFG.get("retryCap", 6)))


def _diff_curr_enabled() -> bool:
    if os.environ.get("RL_DIFFICULTY_CURRICULUM", "").strip().lower() in ("0", "false", "no", "off"):
        return False
    return _DIFF_CURR_ENABLED_CFG


def max_scd_for_episode(episode_1based: int) -> float:
    """难度桶课程当前允许的 spawnStepDifficulty scd 上限；未启用或越界返回 1.0。"""
    if not _diff_curr_enabled() or not _DIFF_CURR_STAGES:
        return 1.0
    ep = max(0, int(episode_1based))
    for stage in _DIFF_CURR_STAGES:
        until = int(stage.get("untilEpisode", 0))
        if until <= 0 or ep <= until:
            return float(stage.get("maxScd", 1.0))
    return float(_DIFF_CURR_STAGES[-1].get("maxScd", 1.0))


_ICON_BONUS_LINE_MULT = float(CLEAR_SCORING.get("iconBonusLineMult") or 5)
_PERFECT_CLEAR_MULT = float(CLEAR_SCORING.get("perfectClearMult") or 10)


# Combo 倍数 + grace 窗口默认配置（与 shared/game_rules.json → clearScoring.comboMultiplier 同源）
_COMBO_CFG_RAW = CLEAR_SCORING.get("comboMultiplier") or {}
_COMBO_ENABLED = bool(_COMBO_CFG_RAW.get("enabled", True))
_COMBO_GRACE = max(1, int(_COMBO_CFG_RAW.get("gracePlacements") or 3))
_COMBO_ACTIVATION = max(
    1, int(_COMBO_CFG_RAW.get("activationCount") or _COMBO_CFG_RAW.get("activationStreak") or 3)
)
_COMBO_STEP = max(0.0, float(_COMBO_CFG_RAW.get("stepBonus") or 0.0))
_COMBO_MAX = max(1.0, float(_COMBO_CFG_RAW.get("maxMultiplier") or 1.0))


def _derive_combo_multiplier(combo_count: int) -> float:
    """由 combo 链累计清线次数推导得分倍数（与 web/src/clearScoring.js deriveComboMultiplier 同公式）。
    mult = clamp(1 + max(0, comboCount - activationCount + 1) * stepBonus, 1, maxMultiplier)
    """
    if not _COMBO_ENABLED:
        return 1.0
    n = max(0, int(combo_count or 0))
    if n < _COMBO_ACTIVATION:
        return 1.0
    raw = 1.0 + (n - _COMBO_ACTIVATION + 1) * _COMBO_STEP
    return min(_COMBO_MAX, max(1.0, raw))


def _derive_next_combo_count(
    prev_combo_count: int, rounds_since_last_clear: float, cleared_this_placement: bool
) -> int:
    """按 grace 窗口推导下一个 _combo_count（与 web/src/clearScoring.js deriveNextComboCount 同公式）。
    - 未清 → 返回 prev（不变）
    - 清线且 prev=0 → 1（首次启动）
    - 清线且 gap < grace → prev+1（combo 延续）
    - 清线且 gap ≥ grace → 1（grace 已过，重启）
    """
    if not _COMBO_ENABLED:
        return 0
    if not cleared_this_placement:
        return max(0, int(prev_combo_count or 0))
    prev = max(0, int(prev_combo_count or 0))
    if prev == 0:
        return 1
    if rounds_since_last_clear is None or rounds_since_last_clear == float("inf"):
        return 1
    gap = max(0, int(rounds_since_last_clear or 0))
    return 1 if gap >= _COMBO_GRACE else prev + 1


def _clear_score_gain(
    scoring: dict,
    clear_count: int,
    bonus_line_count: int,
    perfect_clear: bool = False,
    combo_count: int = 0,
) -> float:
    """与 web/src/clearScoring.js computeClearScore 一致；bonus 线数来自 grid.check_lines(icon 规则由 rlBonusScoring.blockIcons 控制)。

    v1.66+: 增加 combo_count 参数 → comboMultiplier，与浏览器主局/小程序/Cocos 同源。
    """
    if clear_count <= 0:
        return 0.0
    base_unit = float(scoring.get("single_line") or 20)
    base_score = base_unit * clear_count * clear_count
    b = min(int(bonus_line_count), int(clear_count))
    if b <= 0:
        subtotal = base_score
    else:
        line_score = base_unit * clear_count
        icon_bonus = line_score * b * (_ICON_BONUS_LINE_MULT - 1)
        subtotal = base_score + icon_bonus
    perfect_mult = _PERFECT_CLEAR_MULT if perfect_clear else 1.0
    combo_mult = _derive_combo_multiplier(combo_count)
    return subtotal * perfect_mult * combo_mult


def _is_perfect_clear(grid: Grid) -> bool:
    return all(cell is None for row in grid.cells for cell in row)


def board_potential(grid: Grid, dock: list[dict]) -> float:
    """势函数 Φ(s)：加权盘面结构质量，用于 Δ 塑形。值域约 [-30, +10]。"""
    gnp = _fg.grid_to_np(grid)
    feats = _fg.fast_board_features(gnp)
    mob = _fg.fast_dock_mobility(gnp, dock)
    return (
        _POT_W_HOLE * feats["holes"]
        + _POT_W_TRANS * (feats["row_trans"] + feats["col_trans"])
        + _POT_W_WELL * feats["wells"]
        + _POT_W_CLOSE * (feats["close1"] + feats["close2"])
        + _POT_W_MOB * (mob / 10.0)
        + _POT_W_ADHESION * feats["edge_exposure"]
    )


def board_potential_np(grid_np: np.ndarray, dock: list[dict]) -> float:
    """势函数（直接接受 numpy grid，避免重复转换）。"""
    feats = _fg.fast_board_features(grid_np)
    mob = _fg.fast_dock_mobility(grid_np, dock)
    return (
        _POT_W_HOLE * feats["holes"]
        + _POT_W_TRANS * (feats["row_trans"] + feats["col_trans"])
        + _POT_W_WELL * feats["wells"]
        + _POT_W_CLOSE * (feats["close1"] + feats["close2"])
        + _POT_W_MOB * (mob / 10.0)
        + _POT_W_ADHESION * feats["edge_exposure"]
    )


class OpenBlockSimulator:
    def __init__(
        self,
        strategy_id: str = "normal",
        *,
        best_score: int = 0,
        run_streak: int = 0,
        condition_arc: str | None = None,
        condition_intent: str | None = None,
        max_scd: float = 1.0,
    ):
        self.strategy_id = strategy_id
        self.best_score = max(0, int(best_score))
        self.run_streak = max(0, int(run_streak))
        # v12 风格族 token：自博弈训练时由 train 侧采样、推理时由调用方注入。
        self.condition_arc = condition_arc
        self.condition_intent = condition_intent
        # v12 难度桶课程：spawnStepDifficulty.scdNorm 上限，超出则重抽（最多 retryCap 次）。
        self.max_scd = float(max_scd)
        self._holes_cache: int | None = None
        self._grid_np: np.ndarray | None = None
        self._last_clears: int = 0
        self._last_bonus_lines: int = 0
        # Combo 链（**时间维度** combo with grace window）：当前 combo 累计清线次数；与 web _comboCount 同口径。
        # 清线 → 按 grace 窗口推导（gap<grace → +1；gap≥grace → 重启=1）；未清 → 累加 _rounds_since_last_clear。
        # 与「空间维度单手多消」result["count"] 完全独立；进入 _clear_score_gain → comboMultiplier。
        # 术语权威：docs/product/CLEAR_SCORING.md §〇。
        self._combo_count: int = 0
        self._rounds_since_last_clear: float = float("inf")
        self._profile = PlayerProfileLite()
        self._spawn_context: dict = {}
        # v12 评估反馈塑形：每步瞬时奖励项（非势差，无累计 → 无 search 状态污染）。
        # forced_bad：本步落子后空洞净增 ≥ 2（拓扑剧烈恶化，与 roundQuality.forced_bad 同语义近似）。
        # salvage：本步在 mobility 极低（≤4）时仍消行 ≥ 2（"绝境清线"，与 salvage 同语义近似）。
        # _search_mode：MCTS/lookahead/beam 路径下置 True，跳过 eval shaping 的 O(|A|) 计算
        # （search 用 NN-V 估计，shaping 是给真实采集轨迹的 GAE 用的，否则双重计入）。
        self._search_mode: bool = False
        self.reset()

    @staticmethod
    def _create_spawn_context(best_score: int) -> dict:
        return {
            "lastClearCount": 0,
            "roundsSinceClear": 0,
            "recentCategories": [],
            "totalRounds": 0,
            "scoreMilestone": False,
            "bestScore": best_score,
            "pbGrowthFast": False,
            "bottleneckTrough": float("inf"),
            "bottleneckSolutionTrough": float("inf"),
            "bottleneckSamples": 0,
            "specialShapeUsed": 0,
            "specialReliefUsed": 0,
            "specialPressureUsed": 0,
            "totalClears": 0,
            "roundsSinceSpecial": 0,
            "dupInjectUsed": 0,
            "roundsSinceDupInject": 0,
        }

    def reset(self) -> None:
        cfg = strategy_python(self.strategy_id)
        self.win_score_threshold = WIN_SCORE_THRESHOLD
        self.strategy_config = cfg
        self.scoring = cfg["scoring"]
        self.grid = Grid(cfg["grid_width"])
        self.grid.init_board(cfg["fill_ratio"], cfg.get("shape_weights"))
        self.score = 0
        self.total_clears = 0
        self.steps = 0
        self.placements = 0
        self._holes_cache = None
        self._grid_np = None
        self._last_clears = 0
        self._last_bonus_lines = 0
        self._combo_count = 0
        self._rounds_since_last_clear = float("inf")
        self._profile = PlayerProfileLite()
        self._profile.record_new_game()
        self._spawn_context = self._create_spawn_context(self.best_score)
        self._spawn_dock()

    def _cells_for_spawn_bridge(self) -> list[list[int | None]]:
        return [list(row) for row in self.grid.cells]

    def _resample_for_difficulty_cap(self, shapes: list[dict], resampler) -> list[dict]:
        """v12 难度桶课程：若 dock 难度（spawnStepDifficulty[0]）超出 max_scd 上限则重抽。
        无脉冲、不改变最优策略；仅压缩输入难度分布。online/legacy 两条 spawn 路径共用。
        resampler() 须返回与 shapes 同结构（含 data 字段）的新 dock。"""
        if self.max_scd >= 1.0:
            return shapes
        occupied = sum(1 for row in self.grid.cells for c in row if c is not None)
        cur = shapes
        for _ in range(_DIFF_CURR_RETRY_CAP):
            feats = spawn_step_difficulty_features([s["data"] for s in cur], occupied)
            if feats[0] <= self.max_scd:
                return cur
            cur = resampler()
        return cur

    def _spawn_dock_legacy(self) -> None:
        n_colors = int(self.strategy_config.get("color_count", 8))
        bias = mono_near_full_line_color_weights(self.grid, _RL_BONUS_ICONS)
        dock_colors = pick_three_dock_colors(bias, n_colors=n_colors)
        all_shapes = get_all_shapes()
        shapes = generate_blocks_for_grid(self.grid, self.strategy_config)
        shapes = self._resample_for_difficulty_cap(
            shapes, lambda: generate_blocks_for_grid(self.grid, self.strategy_config)
        )
        self.dock = []
        for i in range(3):
            shape = shapes[i] if i < len(shapes) else all_shapes[0]
            self.dock.append(
                {
                    "id": shape["id"],
                    "shape": copy.deepcopy(shape["data"]),
                    "color_idx": dock_colors[i],
                    "placed": False,
                }
            )

    def _apply_online_spawn_result(self, resp: dict) -> None:
        shapes = resp.get("shapes") or []
        dock_colors = resp.get("dockColors") or [0, 1, 2]
        all_shapes = get_all_shapes()
        # v12 难度桶课程：online spawn 路径下，每次重抽走 IPC 代价过高，
        # 故若首抽超过 max_scd 上限，则切换到本地 legacy 生成器循环重抽
        # （仅压缩 difficulty 分布，与最优策略无关）。
        if self.max_scd < 1.0 and shapes:
            shapes = self._resample_for_difficulty_cap(
                shapes, lambda: generate_blocks_for_grid(self.grid, self.strategy_config)
            )
        self.dock = []
        for i in range(3):
            shape = shapes[i] if i < len(shapes) else all_shapes[0]
            self.dock.append(
                {
                    "id": shape["id"],
                    "shape": copy.deepcopy(shape["data"]),
                    "color_idx": int(dock_colors[i]) if i < len(dock_colors) else i,
                    "placed": False,
                }
            )
        patch = resp.get("spawnContext")
        if isinstance(patch, dict):
            self._spawn_context.update(patch)
        prof = resp.get("profileJson")
        if isinstance(prof, dict):
            self._profile = PlayerProfileLite.from_json(prof)

    def _remember_recent_categories(self) -> None:
        cats = [shape_category(b["id"]) for b in self.dock]
        prev = list(self._spawn_context.get("recentCategories") or [])
        self._spawn_context["recentCategories"] = (prev + cats)[-9:]
        self._spawn_context["totalClears"] = self.total_clears

    def save_state(self) -> dict:
        """Snapshot for 1-step lookahead. v12: 同时保存评估反馈累计，避免 search 中
        临时 step() 污染主路径的 ΔΦ_eval（否则前瞻评估结果会反向流入真实奖励 = 泄漏）。"""
        return {
            "cells": [row[:] for row in self.grid.cells],
            "dock": [
                {
                    "id": b["id"],
                    "shape": [r[:] for r in b["shape"]],
                    "color_idx": b["color_idx"],
                    "placed": b["placed"],
                }
                for b in self.dock
            ],
            "score": self.score,
            "total_clears": self.total_clears,
            "steps": self.steps,
            "placements": self.placements,
        }

    def restore_state(self, s: dict) -> None:
        n = self.grid.size
        for y in range(n):
            for x in range(n):
                self.grid.cells[y][x] = s["cells"][y][x]
        self.dock = [
            {
                "id": b["id"],
                "shape": [r[:] for r in b["shape"]],
                "color_idx": b["color_idx"],
                "placed": b["placed"],
            }
            for b in s["dock"]
        ]
        self.score = s["score"]
        self.total_clears = s["total_clears"]
        self.steps = s["steps"]
        self.placements = s["placements"]
        self._holes_cache = None
        self._grid_np = None

    def _spawn_dock(self) -> None:
        if _spawn_online.spawn_online_enabled():
            try:
                self._profile.record_spawn()
                resp = _spawn_online.spawn_dock_online(
                    {
                        "strategyId": self.strategy_id,
                        "winScoreThreshold": self.win_score_threshold,
                        "bestScore": self.best_score,
                        "runStreak": self.run_streak,
                        "score": self.score,
                        "totalClears": self.total_clears,
                        "placements": self.placements,
                        "steps": self.steps,
                        "cells": self._cells_for_spawn_bridge(),
                        "spawnContext": copy.deepcopy(self._spawn_context),
                        "profileJson": self._profile.to_json(),
                    }
                )
                self._apply_online_spawn_result(resp)
                self._spawn_context["scoreMilestone"] = False
                return
            except Exception:
                _spawn_online.warn_legacy_fallback_once()
        self._spawn_dock_legacy()

    def _ensure_grid_np(self) -> np.ndarray:
        if self._grid_np is None:
            self._grid_np = _fg.grid_to_np(self.grid)
        return self._grid_np

    def _invalidate_grid_np(self) -> None:
        self._grid_np = None
        self._holes_cache = None

    def _get_holes(self) -> int:
        if self._holes_cache is None:
            gnp = self._ensure_grid_np()
            self._holes_cache = _fg.fast_board_features(gnp)["holes"]
        return self._holes_cache

    def count_holes(self) -> int:
        """当前盘面空洞格数（与即时奖励塑形、训练辅助损失一致）。"""
        return self._get_holes()

    def get_legal_actions(self) -> list[dict[str, int]]:
        gnp = self._ensure_grid_np()
        return _fg.get_all_legal_actions(gnp, self.dock)

    def extract_state(self) -> np.ndarray:
        """v12 统一入口：所有 search / lookahead / MCTS 路径必须用本方法取 state，
        以保证 condition token 段始终注入当前 sim 的 (arc, intent)。"""
        from .features import extract_state_features
        return extract_state_features(
            self.grid, self.dock, self.strategy_id,
            arc=self.condition_arc, intent=self.condition_intent,
        )

    def count_clears_if_placed(self, block_idx: int, gx: int, gy: int) -> int:
        b = self.dock[block_idx]
        return _fg.count_clears_single(self._ensure_grid_np(), _fg.shape_to_np(b["shape"]), gx, gy)

    def batch_count_clears(self, actions: list[dict]) -> np.ndarray:
        """批量消行预测：同一 shape 走 numpy 向量化，不同 shape 分组。"""
        gnp = self._ensure_grid_np()
        groups: dict[int, list[int]] = {}
        for i, a in enumerate(actions):
            groups.setdefault(a["block_idx"], []).append(i)

        result = np.zeros(len(actions), dtype=np.int32)
        for bi, indices in groups.items():
            shape_np = _fg.shape_to_np(self.dock[bi]["shape"])
            positions = np.array([[actions[i]["gy"], actions[i]["gx"]] for i in indices], dtype=np.int32)
            result[indices] = _fg.batch_count_clears(gnp, shape_np, positions)
        return result

    def is_terminal(self) -> bool:
        remaining = [b for b in self.dock if not b["placed"]]
        if not remaining:
            return False
        gnp = self._ensure_grid_np()
        for b in remaining:
            positions = _fg.get_legal_positions(gnp, _fg.shape_to_np(b["shape"]))
            if len(positions) > 0:
                return False
        return True

    def check_feasibility(self) -> float:
        """1.0 if ALL remaining dock blocks can be placed (at least one legal move each), else 0.0."""
        gnp = self._ensure_grid_np()
        for b in self.dock:
            if b["placed"]:
                continue
            positions = _fg.get_legal_positions(gnp, _fg.shape_to_np(b["shape"]))
            if len(positions) == 0:
                return 0.0
        return 1.0

    def count_sequential_solution_leaves(self, leaf_cap: int = 64, node_budget: int = 2000) -> int:
        """统计当前 dock 剩余块是否存在可全部放完的顺序。

        `check_feasibility()` 只看每块单独有无位置；这里枚举真实放置顺序，
        更贴近训练时需要规避的“三块序贯死局”。
        """
        remaining_depth = sum(1 for b in self.dock if not b.get("placed"))
        if remaining_depth <= 0:
            return 1

        saved_root = self.save_state()
        nodes = 0

        def dfs(depth: int) -> int:
            nonlocal nodes
            if depth >= remaining_depth:
                return 1
            if nodes >= node_budget:
                return 0
            legal = self.get_legal_actions()
            if not legal:
                return 0
            subtotal = 0
            state = self.save_state()
            for a in legal:
                if nodes >= node_budget or subtotal >= leaf_cap:
                    break
                nodes += 1
                self.step(a["block_idx"], a["gx"], a["gy"])
                subtotal += dfs(depth + 1)
                self.restore_state(state)
            return min(subtotal, leaf_cap)

        leaves = dfs(0)
        self.restore_state(saved_root)
        return int(min(leaves, leaf_cap))

    def check_sequential_feasibility(self, node_budget: int = 200) -> float:
        return 1.0 if self.count_sequential_solution_leaves(leaf_cap=1, node_budget=node_budget) > 0 else 0.0

    def get_supervision_signals(self, feasibility_node_budget: int = 200) -> dict[str, float]:
        """一次调用返回所有直接监督目标值。v12 新增 spawn_difficulty_after：trunk 显式预测
        本步落子（dock 重抽）后的 4 维 spawnStepDifficulty 子向量，强化对难度的归纳偏置。"""
        gnp = self._ensure_grid_np()
        occupied = int(_fg.fast_board_features(gnp)["filled"])
        unplaced_shapes = [b["shape"] for b in self.dock if not b.get("placed")]
        return {
            "board_quality": board_potential_np(gnp, self.dock) / _BOARD_POT_NORM,
            "feasibility": self.check_sequential_feasibility(node_budget=feasibility_node_budget),
            "topology_after": _fg.topology_aux_targets(gnp, self.dock, _ACTION_NORM),
            "spawn_difficulty_after": np.asarray(
                spawn_step_difficulty_features(unplaced_shapes, occupied), dtype=np.float32
            ),
        }

    def _eval_step_reward(
        self,
        regret: float,
        is_optimal: float,
        forced_bad: int,
        salvage: int,
    ) -> float:
        """评估反馈：本步瞬时塑形（非势差，因 Φ 若随时间步漂移会注入伪势能）。

        rewards = w_reg·(−clip(regret/REG_NORM, 0, 1))      # regret 越小越好
                + w_opt·optimality                          # 0~1，越高越好
                + w_fb·(−forced_bad)                        # 触发即 −1
                + w_sv·(+salvage)                           # 触发即 +1
        所有项均为本步增量，与时间无关；reward 直接 = 该值，无 ΔΦ。
        """
        reg_clip = min(1.0, max(0.0, regret) / _EVAL_REGRET_NORM)
        return (
            _EVAL_W_REG * (-reg_clip)
            + _EVAL_W_OPT * float(is_optimal)
            + _EVAL_W_FB * (-float(forced_bad))
            + _EVAL_W_SV * float(salvage)
        )

    def _compute_eval_signals(
        self,
        chosen_reward: float,
        best_reward: float,
        holes_before: int,
        holes_after: int,
        mobility_before: int,
        clears: int,
    ) -> tuple[float, float, int, int]:
        """返回本步评估信号（不持久化任何累计，避免 search/lookahead 数据泄漏）：

        - regret = max(0, best_reward - chosen_reward)，近似 placementQuality.regret。
        - optimality = clip01(chosen / max(best, ε))，best≈0 时记 1.0。
        - forced_bad ∈ {0,1}：本步空洞净增 ≥ 2 → 1。
        - salvage ∈ {0,1}：mobility ≤ 4 且 clears ≥ 2 → 1。"""
        regret = max(0.0, float(best_reward) - float(chosen_reward))
        if best_reward > 1e-6:
            optim = max(0.0, min(1.0, chosen_reward / best_reward))
        else:
            optim = 1.0
        forced_bad = 1 if (holes_after - holes_before) >= 2 else 0
        salvage = 1 if (mobility_before <= 4 and clears >= 2) else 0
        return regret, optim, forced_bad, salvage

    @contextlib.contextmanager
    def search_mode(self):
        """上下文管理器：进入期间 step() 跳过 eval feedback shaping 的 O(|A|) 计算。
        MCTS / lookahead / beam-search 等不收 reward 的探索路径包此 with 块。"""
        prev = self._search_mode
        self._search_mode = True
        try:
            yield
        finally:
            self._search_mode = prev

    def _estimate_best_immediate_reward(self) -> float:
        """评估当前合法动作集中"立刻消行得分"的最大值（仅用于 regret 估计；
        不调用 self.step()，避免破坏状态）。复杂度 O(|A|)，节省 vs 真模拟。"""
        gnp = self._ensure_grid_np()
        legal = _fg.get_all_legal_actions(gnp, self.dock)
        if not legal:
            return 0.0
        best = 0.0
        for a in legal:
            shape = self.dock[a["block_idx"]]["shape"]
            c = _fg.count_clears_single(gnp, _fg.shape_to_np(shape), a["gx"], a["gy"])
            if c <= 0:
                continue
            # 用 c² 近似上界（不含 bonus / combo，已足够指示相对优劣）
            best = max(best, float(self.scoring.get("single_line") or 20) * c * c)
        return best

    def step(self, block_idx: int, gx: int, gy: int) -> float:
        b = self.dock[block_idx]
        if b["placed"] or not self.grid.can_place(b["shape"], gx, gy):
            return 0.0

        holes_before = self._get_holes()
        pot_before = board_potential_np(self._ensure_grid_np(), self.dock) if _POT_ENABLED else 0.0
        prev_score = self.score
        # v12 评估反馈：在落子前估计当前合法动作集中即时奖励上界（regret 计算用）
        # 与本动作 mobility（已落子前合法动作总数），用于 salvage 判定
        if _EVAL_FB_ENABLED and not self._search_mode:
            best_immediate = self._estimate_best_immediate_reward()
            mobility_before = int(_fg.fast_dock_mobility(self._ensure_grid_np(), self.dock))
        else:
            best_immediate = 0.0
            mobility_before = 0
        self.grid.place(b["shape"], b["color_idx"], gx, gy)
        self._invalidate_grid_np()
        self.placements += 1
        self.steps += 1

        result = self.grid.check_lines(bonus_block_icons=_RL_BONUS_ICONS)
        gain = 0.0
        self._last_clears = 0
        self._last_bonus_lines = 0
        clears = 0
        if result["count"] > 0:
            self._last_clears = int(result["count"])
            clears = self._last_clears
            self.total_clears += clears
            bonus_n = len(result.get("bonus_lines") or [])
            self._last_bonus_lines = int(bonus_n)
            # Combo (grace 窗口推导)；与 web 主局 deriveNextComboCount 同公式。
            self._combo_count = _derive_next_combo_count(
                self._combo_count, self._rounds_since_last_clear, True
            )
            self._rounds_since_last_clear = 0
            gain = _clear_score_gain(
                self.scoring,
                clears,
                bonus_n,
                _is_perfect_clear(self.grid),
                combo_count=self._combo_count,
            )
            self.score += gain
            self._spawn_context["lastClearCount"] = clears
            self._spawn_context["roundsSinceClear"] = 0
        else:
            self._last_clears = 0
            # 未清线 → 累加 grace 计数；_combo_count 不归零（由下次清线判定）
            if self._rounds_since_last_clear != float("inf"):
                self._rounds_since_last_clear += 1
            self._spawn_context["lastClearCount"] = 0

        b["placed"] = True
        fill_after = sum(
            1 for row in self.grid.cells for cell in row if cell is not None
        ) / max(self.grid.size * self.grid.size, 1)
        self._profile.record_place(clears > 0, clears, fill_after)
        if all(x["placed"] for x in self.dock):
            if self._spawn_context.get("lastClearCount", 0) == 0:
                self._spawn_context["roundsSinceClear"] = int(
                    self._spawn_context.get("roundsSinceClear", 0)
                ) + 1
            self._remember_recent_categories()
            self._spawn_dock()

        self._invalidate_grid_np()

        # v5: 精简奖励 = 得分增量 + 势函数塑形 + 胜利奖励
        # 其余「每步放置质量」由直接监督头学习，不注入奖励
        r = gain

        if _POT_ENABLED:
            pot_after = board_potential_np(self._ensure_grid_np(), self.dock)
            r += _POT_COEF * (pot_after - pot_before)

        if _EVAL_FB_ENABLED and not self._search_mode:
            holes_after_step = self._get_holes()
            regret, optim, fb, sv = self._compute_eval_signals(
                chosen_reward=gain,
                best_reward=best_immediate,
                holes_before=holes_before,
                holes_after=holes_after_step,
                mobility_before=mobility_before,
                clears=clears,
            )
            r += _EVAL_FB_COEF * self._eval_step_reward(regret, optim, fb, sv)

        rs = RL_REWARD_SHAPING
        wb = float(rs.get("winBonus") or 0.0)
        thr = getattr(self, "win_score_threshold", WIN_SCORE_THRESHOLD)
        # 当外部启用 smooth winBonus（v11.2 方案 B）时，sparse 触发让位给
        # train.py 在局末统一注入 smooth_reward，避免 sparse + smooth 重复加成。
        # 优先读 instance 属性；fallback 读环境变量以兼容 worker pool / fork 路径
        # （子进程通过 env 继承，不需修改 collect_episode 签名）。
        skip_sparse = bool(getattr(self, "_skip_sparse_win_bonus", False))
        if not skip_sparse:
            _env = os.environ.get("RL_SMOOTH_WIN_BONUS", "").strip().lower()
            if _env in ("1", "true", "yes", "on"):
                skip_sparse = True
        if wb and not skip_sparse and self.score >= thr and prev_score < thr:
            r += wb
        return r
