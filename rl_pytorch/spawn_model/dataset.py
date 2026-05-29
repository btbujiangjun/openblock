"""
从 SQLite move_sequences 提取训练数据（v2）。

每个样本 = (board_state, context_scalars, recent_shape_ids) → (target_shape_ids)

v2 改进：
  - CONTEXT_DIM 12 → 24：涵盖完整玩家能力画像 + 自适应策略信号
  - 新增品类标签用于多样性辅助损失
  - 采样权重同时考虑分数和消行率（避免纯分数膨胀）

v3.1 改进：
  - BEHAVIOR_CONTEXT_DIM=56：在旧 24 维基础上显式加入冷启动、拓扑、
    AbilityVector、spawnTargets、spawnHints 与 spawnIntent one-hot。

v1.57.1 多端策略同步（2026-05-18）：
  - BEHAVIOR_CONTEXT_DIM 56 → 57：spawnIntent one-hot 从 6 类扩到 7 类，
    新增 'sprint' 中间档（stress ∈ [0.45, 0.55) 渐紧过渡带，web/src/adaptiveSpawn.js 同源）。
  - 旧 checkpoint 因 input shape 变化（board_proj.in_features 120→121）需重训；
    旧数据（无 sprint 标签）自动落到 maintain（idx=5），不会破坏向后兼容。

v1.63 出块数据集补全（2026-05-29）：
  - 配合 web 端 PLAYER_STATE_SNAPSHOT_VERSION 3，消费新增字段并补齐「优化」所需标签：
    * spawnGeo.nearFullLines/close1/close2 此前 snapshot 未写 → behaviorContext[28-30] 恒 0，
      现已落库（detectNearClears 同源），无需改 _parse_behavior_context（索引不变，值变真实）。
    * 新增 **逐 triplet 因果结果** outcome 向量（OUTCOME_DIM=7）：消行数 / 得分增量 /
      填充 delta / 空洞 delta / 落子数 / 单步最大消行 / 一手清屏；由 _compute_spawn_outcome
      从 spawn→下一 spawn 间的 place 帧聚合。weight 叠加 _outcome_weight_factor 因果微调。
    * 新增 **局级终局标签** game_over_reason / died（'jam'=被怼死）：从 sessions.game_over_reason
      列读取（旧库 PRAGMA 探测后退化为 NULL），挂到每条样本元数据。
    * 新增 **会话级留存** load_session_retention()：join player_visits 算 returned_24h/7d /
      played_next_session / next_gap_sec，供"出块策略→留存"的优化目标对齐。
    * 样本元数据新增 spawn_source（provenance.spawnSource）供反事实/分组对比（不进网络）。
  - outcome 已进 SpawnDataset.__getitem__（tensor），train_v3 可选用于 reward/advantage 加权；
    旧训练脚本只取已知键，新增键不破坏默认 collate。
  - 需求1（PB 采样波动 + reward 口径）：采样时让 PB 围绕"指定数值"（本局 run-start bestScore /
    打包行 pb_baseline）上下波动（PB_JITTER_DEFAULT=0.15，域随机化避免常量），并把 reward 的
    计算口径绑定到**采样到的 PB**（_pb_reward，与 pbTension 中心 0.82 同口径）。样本新增
    pb_sampled / pb_ratio_sampled / reward；reward/pb_ratio_sampled 已进 __getitem__。
  - 需求2（打包成 append-only 样本集 + 自动同步 + 不支持删除）：server.py 建 spawn_dataset_samples
    表（UNIQUE(session_id) 幂等 UPSERT、BEFORE DELETE 触发器 WORM、payload 存 frames 独立副本），
    由 move-sequence 写入 / 会话结算自动同步；本模块 load_packed_dataset() 从该表读取（删除安全），
    load_training_data(prefer_packed=True) 默认优先样本集、回退 sessions⨝move_sequences。

v1.61.0 显式 θ 条件（2026-05-29）：
  - BEHAVIOR_CONTEXT_DIM 57 → 61：尾部追加 4 维归一化 PB 曲线 θ
    （pbTensionCenter/Width、pbBrakeCenter/Width），来源 ps.adaptive.stressBreakdown.pbCurveParams。
    把 L2 SpawnParamTuner → L1 SpawnPolicyNet 的隐式耦合转成显式条件输入，避免「换 θ 不重训」
    导致的训练/服务分布漂移；缺省 θ → 默认域（与历史 HandTuned 数据一致）。
  - 新增样本元数据 'theta_regime'（int，不进网络）供分层重训 / 漂移分组。
  - board_proj.in_features 121 → 125；旧 checkpoint 需重训才能在 model-v3 下生效。

v1.60.0 形状池扩展（2026-05-18）：
  - SHAPE_VOCAB 28 → 40：新增 12 形状（占格 2-3，配合"前期减压/后期加压"策略）：
      lines  +4: 1x2 / 2x1 / 1x3 / 3x1                  —— 前期减压（直线小块易消行）
      zshapes +4: diag-2a / diag-2b / diag-3a / diag-3b —— 斜线散点（diag-2 中性 / diag-3 加压）
      lshapes +4: l3-a / l3-b / l3-c / l3-d             —— 3 格 L 角（中性·角落补缝）
    顺序约定（**必须**与 web/src/spawnModel.js SHAPE_VOCAB 严格一致）：
      旧 28 个保持 idx 0-27 不变（兼容旧统计 / 旧 checkpoint 推理路径前缀），
      新 12 个紧追在末尾 idx 28-39，且与 web 端顺序逐项对齐。
  - SHAPE_CATEGORY 同步补 12 个映射（zshapes idx=4、lshapes idx=5，与现有同 category 一致）。
  - ⚠ 旧 SpawnTransformer / model-v3 checkpoint 的 NUM_SHAPES=28 输出维失效，必须重新训练：
      `python -m rl_pytorch.spawn_model.train` 或 `train_v3`（数据库 move_sequences 重新采样新形状即可）。
    重训前 model-v3 推理会因 logits dim mismatch 报错；rule 模式（默认）不受影响。
"""

import json
import sqlite3
import numpy as np
from pathlib import Path

SHAPE_VOCAB = [
    '1x4', '4x1', '1x5', '5x1', '2x3', '3x2', '2x2', '3x3',
    't-up', 't-down', 't-left', 't-right',
    'z-h', 'z-h2', 'z-v', 'z-v2',
    'l-1', 'l-2', 'l-3', 'l-4', 'l5-a', 'l5-b', 'l5-c', 'l5-d',
    'j-1', 'j-2', 'j-3', 'j-4',
    # v1.60.0 新增 12（按 category 顺序追加，保持原 0-27 idx 兼容）
    '1x2', '2x1', '1x3', '3x1',
    'diag-2a', 'diag-2b', 'diag-3a', 'diag-3b',
    'l3-a', 'l3-b', 'l3-c', 'l3-d',
]
SHAPE_TO_IDX = {s: i for i, s in enumerate(SHAPE_VOCAB)}
NUM_SHAPES = len(SHAPE_VOCAB)
GRID_SIZE = 8
CONTEXT_DIM = 24
# v1.57.1：56 → 57，spawnIntent one-hot 从 6 → 7 维（新增 sprint，与 web/src/adaptiveSpawn.js 同源）。
# v1.61.0：57 → 61，显式追加 4 维 PB 曲线 θ（pbTensionCenter/Width、pbBrakeCenter/Width，归一化），
#          把 L2 SpawnParamTuner → L1 SpawnPolicyNet 的隐式耦合转成显式条件，规避换 θ 不重训的分布漂移。
BEHAVIOR_CONTEXT_DIM = 61
HISTORY_LEN = 3

# v1.61.0：4 维 PB 曲线 θ 的归一化区间与默认值（必须与 web/src/spawnModel.js SPAWN_PB_THETA_RANGES 严格一致）。
_PB_THETA_KEYS = ['pbTensionCenter', 'pbTensionWidth', 'pbBrakeCenter', 'pbBrakeWidth']
_PB_THETA_RANGES = {
    'pbTensionCenter': (0.70, 0.92),
    'pbTensionWidth': (0.04, 0.15),
    'pbBrakeCenter': (0.98, 1.15),
    'pbBrakeWidth': (0.03, 0.12),
}
_PB_THETA_DEFAULTS = {
    'pbTensionCenter': 0.82,
    'pbTensionWidth': 0.08,
    'pbBrakeCenter': 1.05,
    'pbBrakeWidth': 0.06,
}

SHAPE_CATEGORY = {
    '1x4': 0, '4x1': 0, '1x5': 0, '5x1': 0,
    '2x3': 1, '3x2': 1,
    '2x2': 2, '3x3': 2,
    't-up': 3, 't-down': 3, 't-left': 3, 't-right': 3,
    'z-h': 4, 'z-h2': 4, 'z-v': 4, 'z-v2': 4,
    'l-1': 5, 'l-2': 5, 'l-3': 5, 'l-4': 5,
    'l5-a': 5, 'l5-b': 5, 'l5-c': 5, 'l5-d': 5,
    'j-1': 6, 'j-2': 6, 'j-3': 6, 'j-4': 6,
    # v1.60.0 新增 12 形状的 category 映射（与 shared/shapes.json 同源）
    '1x2': 0, '2x1': 0, '1x3': 0, '3x1': 0,
    'diag-2a': 4, 'diag-2b': 4, 'diag-3a': 4, 'diag-3b': 4,
    'l3-a': 5, 'l3-b': 5, 'l3-c': 5, 'l3-d': 5,
}
NUM_CATEGORIES = 7


def _parse_board(grid_json):
    cells = grid_json.get('cells', [])
    board = np.zeros((GRID_SIZE, GRID_SIZE), dtype=np.float32)
    for y in range(min(GRID_SIZE, len(cells))):
        row = cells[y]
        for x in range(min(GRID_SIZE, len(row))):
            if row[x] is not None:
                board[y][x] = 1.0
    return board


def _safe(val, default=0.0):
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


_FLOW_MAP = {'bored': -1.0, 'flow': 0.0, 'anxious': 1.0}
_PACING_MAP = {'early': 0.0, 'tension': 0.5, 'release': 1.0}
_SESSION_MAP = {'warmup': 0.0, 'peak': 0.5, 'cooldown': 1.0}
# v1.57.1：新增 'sprint' 中间档（在末尾，保持 idx 0~5 与旧版一致；
# _intent_one_hot 对未知 intent 已有 ValueError catch → 'maintain' fallback，无需特别处理）。
_SPAWN_INTENTS = ['relief', 'engage', 'harvest', 'pressure', 'flow', 'maintain', 'sprint']
_HOLE_PRESSURE_MAX = 8.0


def _parse_context(ps):
    """Extract 24-dim context from player state snapshot (v2)."""
    if not ps or not isinstance(ps, dict):
        return np.zeros(CONTEXT_DIM, dtype=np.float32)

    metrics = ps.get('metrics', {}) or {}
    adaptive = ps.get('adaptive', {}) or {}
    hints = adaptive.get('spawnHints', {}) or {}

    return np.array([
        # [0-3] 基础状态
        min(1.0, _safe(ps.get('score'), 0) / 500.0),
        _safe(ps.get('boardFill'), 0),
        _safe(ps.get('skill'), 0.5),
        _safe(ps.get('momentum'), 0),
        # [4-7] 情绪与认知
        _safe(ps.get('frustration'), 0),
        _safe(ps.get('cognitiveLoad'), 0),
        _safe(ps.get('engagementAPM'), 0) / 30.0,
        _safe(ps.get('flowDeviation'), 0),
        # [8-11] 标志位
        1.0 if ps.get('needsRecovery') else 0.0,
        1.0 if ps.get('hadNearMiss') else 0.0,
        1.0 if ps.get('isNewPlayer') else 0.0,
        min(1.0, _safe(ps.get('recentComboStreak'), 0) / 5.0),
        # [12-16] 统计指标
        min(1.0, _safe(metrics.get('clearRate'), 0)),
        min(1.0, _safe(metrics.get('missRate'), 0)),
        min(1.0, _safe(metrics.get('comboRate'), 0)),
        min(_safe(metrics.get('thinkMs'), 3000) / 10000.0, 1.0),
        min(_safe(metrics.get('afkCount'), 0) / 5.0, 1.0),
        # [17-19] 长周期能力评估
        _safe(ps.get('historicalSkill'), 0.5),
        np.clip(_safe(ps.get('trend'), 0), -1, 1),
        _safe(ps.get('confidence'), 0),
        # [20-23] 自适应策略信号
        np.clip(_safe(adaptive.get('stress'), 0), -0.5, 1.5),
        _FLOW_MAP.get(ps.get('flowState'), 0.0),
        _PACING_MAP.get(ps.get('pacingPhase'), 0.5),
        _SESSION_MAP.get(adaptive.get('sessionPhase'), 0.5),
    ], dtype=np.float32)


def _clamp01(v):
    return float(np.clip(_safe(v), 0.0, 1.0))


def _scale_unit(v, max_v, default=0.0):
    return float(np.clip(_safe(v, default) / max(1.0, float(max_v)), 0.0, 1.0))


def _norm_pb_theta(params):
    """把 4 维 PB 曲线 θ 归一化到 [0,1]（缺省/缺字段 → 默认 θ，与历史 HandTuned 数据同域）。"""
    p = params if isinstance(params, dict) else {}
    out = []
    for k in _PB_THETA_KEYS:
        lo, hi = _PB_THETA_RANGES[k]
        v = _safe(p.get(k), _PB_THETA_DEFAULTS[k])
        out.append(float(np.clip((v - lo) / (hi - lo), 0.0, 1.0)))
    return out


def theta_regime_id(params):
    """由 4 维 PB θ 派生稳定整型 regime id（供分层重训 / 漂移分组）。

    缺省 θ → 固定 id（默认/HandTuned 域）；不同 θ 组 → 不同 id。跨进程稳定（不依赖 Python hash 随机化）。
    """
    p = params if isinstance(params, dict) else {}
    h = 0
    for k in _PB_THETA_KEYS:
        x = int(round(_safe(p.get(k), _PB_THETA_DEFAULTS[k]) * 1000))
        h = (h * 1000003 + (x & 0xFFFFFFFF)) & 0x7FFFFFFF
    return int(h)


def _intent_one_hot(intent):
    out = [0.0] * len(_SPAWN_INTENTS)
    try:
        idx = _SPAWN_INTENTS.index(intent or 'maintain')
    except ValueError:
        idx = _SPAWN_INTENTS.index('maintain')
    out[idx] = 1.0
    return out


def _parse_behavior_context(ps):
    """Extract V3.1 57-dim behavior context from player state snapshot (v1.57.1 升级，含 sprint one-hot)."""
    if not ps or not isinstance(ps, dict):
        return np.zeros(BEHAVIOR_CONTEXT_DIM, dtype=np.float32)

    base = _parse_context(ps).tolist()
    metrics = ps.get('metrics', {}) or {}
    ability = ps.get('ability', {}) or {}
    adaptive = ps.get('adaptive', {}) or {}
    hints = adaptive.get('spawnHints', {}) or {}
    targets = adaptive.get('spawnTargets') or hints.get('spawnTargets') or {}
    breakdown = adaptive.get('stressBreakdown') or {}
    geo = ps.get('spawnGeo') or {}

    samples = _safe(metrics.get('samples'), 0)
    active_samples = _safe(metrics.get('activeSamples'), samples)
    holes = _safe(geo.get('holes'), ability.get('features', {}).get('holes', 0))
    fill = _safe(ps.get('boardFill'), adaptive.get('fillRatio', 0))
    hole_pressure = float(np.clip(holes / _HOLE_PRESSURE_MAX, 0.0, 1.0))
    board_difficulty = float(np.clip(fill + hole_pressure * 0.8, 0.0, 1.0))
    board_risk = _clamp01(breakdown.get('boardRisk', ability.get('riskLevel', 0)))
    session_arc = hints.get('sessionArc') or adaptive.get('sessionPhase')

    values = [
        *base,
        # [24-31] 数据可信度与盘面拓扑
        1.0 if samples <= 0 else 0.0,
        _scale_unit(active_samples or samples, 20),
        board_difficulty,
        _scale_unit(holes, 10),
        _scale_unit(geo.get('nearFullLines'), 8),
        _scale_unit(geo.get('close1'), 8),
        _scale_unit(geo.get('close2'), 8),
        _scale_unit(geo.get('solutionCount'), 64),
        # [32-37] AbilityVector
        _clamp01(ability.get('skillScore', ps.get('skill', 0.5))),
        _clamp01(ability.get('controlScore', 0.5)),
        _clamp01(ability.get('clearEfficiency', 0.5)),
        _clamp01(ability.get('boardPlanning', 0.5)),
        _clamp01(ability.get('riskTolerance', 0.5)),
        _clamp01(ability.get('riskLevel', board_risk)),
        # [38-47] 策略目标与出块提示
        _clamp01(targets.get('shapeComplexity', 0)),
        _clamp01(targets.get('solutionSpacePressure', 0)),
        _clamp01(targets.get('clearOpportunity', 0)),
        _clamp01(targets.get('spatialPressure', 0)),
        _clamp01(targets.get('payoffIntensity', 0)),
        _clamp01(targets.get('novelty', 0)),
        _scale_unit(hints.get('clearGuarantee'), 3),
        float(np.clip((_safe(hints.get('sizePreference'), 0) + 1.0) / 2.0, 0.0, 1.0)),
        _clamp01(hints.get('multiClearBonus', 0)),
        _clamp01(hints.get('orderRigor', 0)),
        # [48-54] spawnIntent one-hot (v1.57.1：6 → 7 维，加 sprint)
        *_intent_one_hot(hints.get('spawnIntent') or adaptive.get('spawnIntent')),
        # [55-56] 额外策略上下文
        _scale_unit(hints.get('multiLineTarget'), 2),
        _SESSION_MAP.get(session_arc, 0.5),
        # [57-60] PB 曲线 θ（v1.61.0 显式条件，归一化；缺省 → 默认 θ 域）
        *_norm_pb_theta(breakdown.get('pbCurveParams')),
    ]
    return np.asarray(values[:BEHAVIOR_CONTEXT_DIM], dtype=np.float32)


def _shape_id_to_idx(shape_id):
    return SHAPE_TO_IDX.get(shape_id, 0)


def _shape_id_to_cat(shape_id):
    return SHAPE_CATEGORY.get(shape_id, 0)


# v1.63（出块数据集补全）：逐 triplet 结果标签向量维度。
#   [0] linesClearedSum  本轮三块累计消行数
#   [1] scoreDelta       本轮得分增量（归一化前的原始差）
#   [2] fillDelta        盘面填充率变化（after - before，负=被改善）
#   [3] holesDelta       空洞数变化（after - before，负=被改善）
#   [4] placedCount      本轮实际落子数（0~3；<3 说明有块被弃用/卡住）
#   [5] maxSingleClear   单步最大消行（≥2 即多消）
#   [6] perfectClear     是否一手清屏（0/1）
OUTCOME_DIM = 7


def _ps_num(ps, *path, default=0.0):
    cur = ps
    for k in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return _safe(cur, default)


def _compute_spawn_outcome(frames, spawn_idx):
    """从 spawn 帧之后到下一个 spawn 帧之间的 place 帧聚合逐 triplet 结果（P0-outcome）。

    这是把数据集从「纯模仿（behavior cloning）」升级为「可做优化」的核心——
    让每一手三块都带上「发出去之后到底发生了什么」的因果结果，供 reward / advantage 加权。
    缺字段（旧 pv<3 帧）时退化为 0，不影响向后兼容。
    """
    spawn_ps = frames[spawn_idx].get('ps') or {}
    fill_before = _ps_num(spawn_ps, 'boardFill')
    holes_before = _ps_num(spawn_ps, 'spawnGeo', 'holes')
    score_before = _ps_num(spawn_ps, 'score')

    lines_sum = 0.0
    placed = 0
    max_single = 0.0
    perfect = 0.0
    last_place_ps = None
    for j in range(spawn_idx + 1, len(frames)):
        fr = frames[j]
        t = fr.get('t')
        if t == 'spawn':
            break
        if t == 'place':
            placed += 1
            pps = fr.get('ps') or {}
            lc = _ps_num(pps, 'linesCleared')
            lines_sum += lc
            if lc > max_single:
                max_single = lc
            if lc > 0 and _ps_num(pps, 'boardFill') <= 1e-6:
                perfect = 1.0
            last_place_ps = pps

    after = last_place_ps if last_place_ps is not None else spawn_ps
    score_after = _ps_num(after, 'score', default=score_before)
    fill_after = _ps_num(after, 'boardFill', default=fill_before)
    holes_after = _ps_num(after, 'spawnGeo', 'holes', default=holes_before)

    return np.array([
        lines_sum,
        score_after - score_before,
        fill_after - fill_before,
        holes_after - holes_before,
        float(placed),
        max_single,
        perfect,
    ], dtype=np.float32)


# ── v1.63 需求1：PB 采样波动 + reward 口径（按采样的 PB 为准）──────────────────
#
# 动机：训练样本里"个人最佳分(PB)"若是常量，模型只能学到该 PB 档位的出块分布，
# 换 PB 即分布外（OOD）。在采样时让 PB 围绕"指定数值"（本局 run-start bestScore）
# 上下波动（域随机化），并把 reward 的计算口径绑定到**采样到的 PB**，逼模型学
# "相对 PB 进度"而非"绝对分数"，与 PB 双 S 曲线（pbTension 中心 0.82）同口径。
PB_JITTER_DEFAULT = 0.15   # 相对波动幅度：sampled = center · (1 ± U(0, jitter))
PB_FLOOR = 50.0            # PB 下限，避免除零 / 早期低 PB 把 reward 放大到爆裂


def _resolve_pb_center(frames, session_score, explicit=None):
    """确定 PB 波动中心（"指定数值"）：显式入参 > 帧内 ps.bestScore > 局分数 > FLOOR。"""
    if explicit is not None and _safe(explicit, 0) > 0:
        return float(explicit)
    if isinstance(frames, list):
        for f in frames:
            if isinstance(f, dict):
                ps = f.get('ps')
                if isinstance(ps, dict):
                    bs = _safe(ps.get('bestScore'), 0)
                    if bs > 0:
                        return float(bs)
    return float(max(PB_FLOOR, _safe(session_score, 0)))


def _sample_pb(pb_center, pb_jitter, rng):
    """围绕中心采样一个波动的 PB（避免常量）。jitter<=0 时退化为常量（关闭波动）。"""
    center = max(PB_FLOOR, float(_safe(pb_center, PB_FLOOR)))
    j = float(_safe(pb_jitter, 0.0))
    if j <= 0:
        return center
    factor = 1.0 + float(rng.uniform(-j, j))
    return max(PB_FLOOR, center * factor)


def _pb_reward(outcome, score_before, pb_sampled):
    """逐 triplet reward，口径**按采样的 PB 为准**（需求1）。

    = 0.5·进度(本轮分增/采样PB) + 0.2·PB邻近塑形(tanh, 中心0.82)
      + 0.15·消行 + 0.25·一手清屏 − 盘面恶化/弃块惩罚。
    PB 越小，同样分增量"越接近突破"→ reward 越高；故波动 PB 直接驱动 reward 波动。
    """
    lines_sum, score_d, fill_d, holes_d, placed, _max_single, perfect = (float(x) for x in outcome)
    pb = max(PB_FLOOR, float(pb_sampled))
    progress = score_d / pb
    pb_ratio_after = (float(score_before) + score_d) / pb
    proximity = float(np.tanh((pb_ratio_after - 0.82) / 0.12))
    r = (0.5 * progress
         + 0.2 * proximity
         + 0.15 * min(lines_sum, 4.0)
         + 0.25 * perfect
         - 0.15 * max(0.0, fill_d)
         - 0.10 * max(0.0, holes_d)
         - 0.05 * max(0.0, 3.0 - placed))
    return float(r)


def _outcome_weight_factor(outcome):
    """由逐 triplet 结果派生 [0.5, 1.8] 的温和加权因子（避免压制主模仿信号）。

    奖励"消行 / 减洞 / 减填充"，惩罚"恶化盘面 / 弃块（placed<3）"。
    纯模仿权重仍由 session 级 score+clearRate 决定，这里是叠加的因果微调。
    """
    lines_sum, _score_d, fill_d, holes_d, placed, _max_single, perfect = (float(x) for x in outcome)
    f = 1.0
    f += 0.12 * min(lines_sum, 4.0)        # 消行越多越可信
    f += 0.30 * perfect                     # 一手清屏强正向
    f -= 0.20 * max(0.0, fill_d)            # 填充上升=盘面恶化
    f -= 0.15 * max(0.0, holes_d)           # 空洞增加=结构恶化
    f -= 0.10 * max(0.0, 3.0 - placed)      # 有块被弃用/卡住
    return float(np.clip(f, 0.5, 1.8))


def extract_samples_from_session(frames, session_score, session_clear_rate=0.0,
                                 session_meta=None, pb_center=None,
                                 pb_jitter=PB_JITTER_DEFAULT, rng=None):
    """
    Extract (board, context, history, targets, categories, weight, outcome, reward) from one game's frames.
    weight 同时考虑分数与消行率，避免纯分数膨胀偏好；v1.63 起叠加逐 triplet 因果结果微调。

    session_meta（可选）：{'game_over_reason': str, 'died': bool, ...} 局级标签，挂到每条样本元数据。

    v1.63 需求1：
      pb_center  PB 波动中心（"指定数值"）；None → 由帧 ps.bestScore / 局分数推断。
      pb_jitter  PB 相对波动幅度（默认 0.15）；<=0 关闭波动（PB 为常量，旧行为）。
      rng        np.random.Generator；None → 新建（每次调用独立，等价每 epoch 重采样）。
    reward 口径绑定到**采样到的 PB**，逼模型学相对 PB 进度而非绝对分数。
    """
    samples = []
    last_grid = None
    spawn_history = []
    session_meta = session_meta or {}
    if rng is None:
        rng = np.random.default_rng()
    pb_center_val = _resolve_pb_center(frames, session_score, pb_center)

    for idx, frame in enumerate(frames):
        t = frame.get('t')
        if t == 'init':
            last_grid = frame.get('grid')
        elif t == 'spawn':
            dock = frame.get('dock', [])
            if len(dock) < 3 or last_grid is None:
                continue

            target_ids = [_shape_id_to_idx(d.get('id', '')) for d in dock[:3]]
            target_cats = np.array([_shape_id_to_cat(d.get('id', '')) for d in dock[:3]], dtype=np.int64)
            board = _parse_board(last_grid)
            ps = frame.get('ps')
            context = _parse_context(ps)
            behavior_context = _parse_behavior_context(ps)
            _pb_params = (((ps or {}).get('adaptive') or {})
                          .get('stressBreakdown') or {}).get('pbCurveParams')
            theta_regime = theta_regime_id(_pb_params)

            # v1.63：逐 triplet 结果标签 + 因果加权因子。
            outcome = _compute_spawn_outcome(frames, idx)

            # v1.63 需求1：本帧 PB 围绕中心波动采样，reward 按采样 PB 计算。
            score_before = _ps_num(ps, 'score')
            pb_sampled = _sample_pb(pb_center_val, pb_jitter, rng)
            pb_ratio_sampled = score_before / max(PB_FLOOR, pb_sampled)
            reward = _pb_reward(outcome, score_before, pb_sampled)

            # v1.63：逐 spawn 策略来源（provenance），仅作元数据（分组 / 反事实对比），不进网络。
            prov = (ps or {}).get('provenance') if isinstance(ps, dict) else None
            spawn_source = (prov or {}).get('spawnSource', 'unknown')

            hist = np.zeros((HISTORY_LEN, 3), dtype=np.int64)
            for i, prev in enumerate(spawn_history[-HISTORY_LEN:]):
                offset = HISTORY_LEN - len(spawn_history[-HISTORY_LEN:]) + i
                for j, sid in enumerate(prev[:3]):
                    hist[offset][j] = sid

            score_w = 1.0 + max(0, session_score - 50) / 200.0
            clear_w = 1.0 + session_clear_rate * 0.5
            weight = (score_w * 0.6 + clear_w * 0.4) * _outcome_weight_factor(outcome)

            samples.append({
                'board': board,
                'context': context,
                'behavior_context': behavior_context,
                'history': hist,
                'targets': np.array(target_ids, dtype=np.int64),
                'categories': target_cats,
                'weight': np.float32(weight),
                # v1.61.0：θ regime 元数据（不进网络，仅供分层重训 / 漂移分组）。
                'theta_regime': np.int64(theta_regime),
                # v1.63：逐 triplet 因果结果向量（OUTCOME_DIM）+ 策略来源 + 局级终局标签元数据。
                'outcome': outcome,
                'spawn_source': spawn_source,
                'game_over_reason': session_meta.get('game_over_reason', 'unknown'),
                'died': bool(session_meta.get('died', False)),
                # v1.63 需求1：采样波动 PB + 据此计算的 reward（口径按采样 PB 为准）。
                'pb_sampled': np.float32(pb_sampled),
                'pb_ratio_sampled': np.float32(pb_ratio_sampled),
                'reward': np.float32(reward),
            })

            spawn_history.append(target_ids)
        elif t == 'place':
            if last_grid is not None and frame.get('gridAfter'):
                last_grid = frame.get('gridAfter')

    return samples


def load_training_data(db_path, min_score=0, max_sessions=500,
                       pb_jitter=PB_JITTER_DEFAULT, seed=None, prefer_packed=True):
    """从 SQLite 抽训练样本。

    v1.63：
      - prefer_packed=True 且存在 spawn_dataset_samples（需求2 的 append-only 样本集）
        且其覆盖足够时，从样本集读取（删除安全）；否则回退 sessions⨝move_sequences。
      - pb_jitter / seed：需求1 的 PB 波动配置，逐 session 用派生子 rng 保证可复现。
    """
    db_path = str(db_path)
    if prefer_packed:
        packed = load_packed_dataset(db_path, min_score=min_score, max_sessions=max_sessions,
                                     pb_jitter=pb_jitter, seed=seed)
        if packed:
            return packed

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    base_rng = np.random.default_rng(seed)

    # v1.63：game_over_reason 列可能不存在于旧库（迁移前）；用 PRAGMA 探测后动态拼 SELECT。
    cur.execute("PRAGMA table_info(sessions)")
    sess_cols = {r[1] for r in cur.fetchall()}
    gor_select = "s.game_over_reason" if 'game_over_reason' in sess_cols else "NULL AS game_over_reason"

    cur.execute(f"""
        SELECT s.id, s.score, {gor_select}, m.frames
        FROM sessions s
        INNER JOIN move_sequences m ON m.session_id = s.id
        WHERE s.status = 'completed' AND s.score >= ?
        ORDER BY s.score DESC
        LIMIT ?
    """, (min_score, max_sessions))

    all_samples = []
    for row in cur.fetchall():
        try:
            frames = json.loads(row['frames'] or '[]')
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(frames, list) or len(frames) < 5:
            continue
        score = row['score'] or 0

        clear_count = sum(1 for f in frames if f.get('t') == 'place')
        spawn_count = sum(1 for f in frames if f.get('t') == 'spawn')
        clear_rate = (clear_count / max(spawn_count, 1)) if spawn_count > 0 else 0.0

        gor = row['game_over_reason'] if 'game_over_reason' in row.keys() else None
        session_meta = {
            'game_over_reason': gor or 'unknown',
            # v1.63：'jam' = 被怼死（无合法落点死局）→ 该局尾段是"算法把人逼死"的负样本来源。
            'died': (gor == 'jam'),
        }

        samples = extract_samples_from_session(
            frames, score, clear_rate, session_meta,
            pb_jitter=pb_jitter, rng=np.random.default_rng(base_rng.integers(0, 2**63 - 1)),
        )
        all_samples.extend(samples)

    conn.close()
    return all_samples


def load_packed_dataset(db_path, min_score=0, max_sessions=500,
                        pb_jitter=PB_JITTER_DEFAULT, seed=None):
    """从 append-only 样本集 `spawn_dataset_samples`（需求2）抽训练样本。

    优点：与原始 sessions/move_sequences **去耦**，原局被删后训练数据仍完整。
    PB 波动中心优先用打包行的 pb_baseline 列（需求1 的"指定数值"），否则回退帧内推断。
    库无该表 / 无数据时返回 []（调用方自行回退 join 路径）。
    """
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT session_id, score, pb_baseline, game_over_reason, payload
            FROM spawn_dataset_samples
            WHERE score >= ?
            ORDER BY score DESC
            LIMIT ?
        """, (min_score, max_sessions))
        rows = cur.fetchall()
    except sqlite3.OperationalError:
        conn.close()
        return []

    base_rng = np.random.default_rng(seed)
    all_samples = []
    for row in rows:
        try:
            payload = json.loads(row['payload'] or '{}')
        except (json.JSONDecodeError, TypeError):
            continue
        frames = payload.get('frames') if isinstance(payload, dict) else None
        if not isinstance(frames, list) or len(frames) < 5:
            continue
        score = row['score'] or 0
        clear_count = sum(1 for f in frames if f.get('t') == 'place')
        spawn_count = sum(1 for f in frames if f.get('t') == 'spawn')
        clear_rate = (clear_count / max(spawn_count, 1)) if spawn_count > 0 else 0.0
        gor = row['game_over_reason']
        session_meta = {'game_over_reason': gor or 'unknown', 'died': (gor == 'jam')}
        samples = extract_samples_from_session(
            frames, score, clear_rate, session_meta,
            pb_center=row['pb_baseline'], pb_jitter=pb_jitter,
            rng=np.random.default_rng(base_rng.integers(0, 2**63 - 1)),
        )
        all_samples.extend(samples)

    conn.close()
    return all_samples


def _to_ms(ts):
    """sessions.start_time / player_visits.* 历史上混存秒与毫秒；统一归一到毫秒。"""
    v = _safe(ts, 0.0)
    if v <= 0:
        return 0.0
    # < 1e11 视为秒级（约 1973 年的毫秒戳上界），换算到毫秒。
    return v * 1000.0 if v < 1e11 else v


def load_session_retention(db_path):
    """会话级留存 / 回访长期标签（P2，优化目标对齐用）。

    出块算法优化的"真因变量"是留存 / 时长 / 挫败，而非单纯模仿高分轨迹。
    本函数把 sessions 与 player_visits join 出每局结束后的回访信号，供离线把
    「出块策略 → 留存」做相关/因果分析或作为 session 级 reward 重加权：

      returned_24h / returned_7d   结束后 24h / 7d 内该用户是否再有会话或访问
      played_next_session          结束后是否还有下一局（churn-after-session 反面）
      next_gap_sec                 到下一次活跃（会话或访问）的间隔秒（无则 None）

    返回 {session_id: {...}}。库无 player_visits 时仅用 sessions 推断。
    """
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("""
        SELECT id, user_id, start_time, end_time
        FROM sessions
        WHERE status = 'completed'
        ORDER BY user_id, start_time
    """)
    sessions = [dict(r) for r in cur.fetchall()]

    # 每个用户的活跃时间点（会话开始 + 访问开始），用于"结束后下一次活跃"判定。
    activity = {}
    for s in sessions:
        activity.setdefault(s['user_id'], []).append(_to_ms(s['start_time']))
    try:
        cur.execute("SELECT user_id, started_at FROM player_visits")
        for r in cur.fetchall():
            activity.setdefault(r['user_id'], []).append(_to_ms(r['started_at']))
    except sqlite3.OperationalError:
        pass  # 旧库无 player_visits 表
    for uid in activity:
        activity[uid].sort()

    DAY_MS = 86400_000.0
    out = {}
    for s in sessions:
        uid = s['user_id']
        end_ms = _to_ms(s['end_time']) or _to_ms(s['start_time'])
        acts = activity.get(uid, [])
        # 严格晚于本局结束的下一次活跃（+1s 容差，避免把本局开始算进去）。
        next_act = next((a for a in acts if a > end_ms + 1000.0), None)
        gap = (next_act - end_ms) / 1000.0 if next_act is not None else None
        out[s['id']] = {
            'returned_24h': bool(next_act is not None and (next_act - end_ms) <= DAY_MS),
            'returned_7d': bool(next_act is not None and (next_act - end_ms) <= 7 * DAY_MS),
            'played_next_session': bool(next_act is not None),
            'next_gap_sec': gap,
        }

    conn.close()
    return out


try:
    import torch
    from torch.utils.data import Dataset

    class SpawnDataset(Dataset):

        def __init__(self, samples):
            self.samples = samples

        def __len__(self):
            return len(self.samples)

        def __getitem__(self, idx):
            s = self.samples[idx]
            return {
                'board': torch.from_numpy(s['board']),
                'context': torch.from_numpy(s['context']),
                'behavior_context': torch.from_numpy(s['behavior_context']),
                'history': torch.from_numpy(s['history']),
                'targets': torch.from_numpy(s['targets']),
                'categories': torch.from_numpy(s['categories']),
                'weight': torch.tensor(s['weight']),
                'theta_regime': torch.tensor(s.get('theta_regime', np.int64(0))),
                # v1.63：逐 triplet 因果结果向量（OUTCOME_DIM）。train_v3 可选用于 reward/advantage 加权；
                # 旧训练脚本只取已知键，新增键不影响默认 collate。
                'outcome': torch.from_numpy(
                    s.get('outcome', np.zeros(OUTCOME_DIM, dtype=np.float32))
                ),
                # v1.63 需求1：reward（按采样 PB 计算）+ 采样 PB ratio，供 reward/advantage 加权。
                'reward': torch.tensor(s.get('reward', np.float32(0.0))),
                'pb_ratio_sampled': torch.tensor(s.get('pb_ratio_sampled', np.float32(0.0))),
            }

except ImportError:
    pass
