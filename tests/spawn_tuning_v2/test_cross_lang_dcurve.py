"""v2.10.18 G12: d_pb_base 跨语言常量同源验证.

业务背景
  d_curve 算法跨三处镜像 (extractor.py / samplerV2.js / policyMetricsV2.js),
  常量漂移会让样本数据/模型预测不一致。本测试用文本级 grep 确保:
  - PB_AWARE_D_BASE / D_PEAK / CENTER / WIDTH / STATE_WEIGHT
  - PRIOR_STRENGTH / MIN_OBS
  - SURPRISE_DAMPING / SURPRISE_MIN_CLEARS / TREND_WINDOW
  在三处源代码中数值完全一致。

数学一致性 (公式 + 端点) 由各 _stepDifficulty / extract_d_curve 单测
在各自语言保证 (Python: test_extractor.py, JS: samplerV2.test.js)。
"""
from __future__ import annotations
import os
import re
import sys
from pathlib import Path
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from rl_pytorch.spawn_tuning_v2.extractor import (
    pb_aware_d_pb_base,
    PB_AWARE_D_BASE, PB_AWARE_D_PEAK, PB_AWARE_CENTER, PB_AWARE_WIDTH,
    PB_AWARE_STATE_WEIGHT, PB_AWARE_PRIOR_STRENGTH, PB_AWARE_MIN_OBS,
    SURPRISE_DAMPING, SURPRISE_MIN_CLEARS, TREND_WINDOW,
    FILL_RATE_WEIGHT, ACTION_FREEDOM_WEIGHT, TREND_WEIGHT,
)


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SAMPLER_JS = REPO_ROOT / "web" / "src" / "tuning" / "v2" / "samplerV2.js"
METRICS_JS = REPO_ROOT / "web" / "src" / "tuning" / "v2" / "policyMetricsV2.js"


def _extract_js_const(src: str, name: str) -> float:
    """从 JS 源中提取 const NAME = NUMBER; 的数值."""
    pattern = rf"const\s+{re.escape(name)}\s*=\s*([0-9.eE+\-]+)\s*;"
    m = re.search(pattern, src)
    if not m:
        raise AssertionError(f"常量 {name} 在 JS 源中未找到 (formula drift?)")
    return float(m.group(1))


# ─────────── 常量同源 ───────────

class TestConstantsAcrossLanguages:
    """v2.10.18: 三处镜像 (extractor.py / samplerV2.js / policyMetricsV2.js) 关键常量一致.

    任一变更后必须三处同步, 否则训练样本跟客户端上报数据公式不一致 → 模型混乱。
    """

    @pytest.fixture(scope="class")
    def js_consts(self):
        consts = {}
        for js_path in [SAMPLER_JS, METRICS_JS]:
            if not js_path.exists():
                pytest.skip(f"{js_path.name} 不存在, 跳过同源校验")
            src = js_path.read_text(encoding="utf-8")
            file_consts = {}
            for name in [
                "PB_AWARE_D_BASE", "PB_AWARE_D_PEAK",
                "PB_AWARE_CENTER", "PB_AWARE_WIDTH",
                "PB_AWARE_STATE_WEIGHT", "PB_AWARE_PRIOR_STRENGTH", "PB_AWARE_MIN_OBS",
                "FILL_RATE_WEIGHT", "ACTION_FREEDOM_WEIGHT", "TREND_WEIGHT",
                "SURPRISE_DAMPING", "SURPRISE_MIN_CLEARS", "TREND_WINDOW",
            ]:
                file_consts[name] = _extract_js_const(src, name)
            consts[js_path.name] = file_consts
        return consts

    def test_pb_aware_endpoints_match(self, js_consts):
        """端点 (d_pb_base 底/顶) 三处一致 — v2.12 复用 ideal (0.20, 1.00)."""
        for fname, cs in js_consts.items():
            assert abs(cs["PB_AWARE_D_BASE"] - PB_AWARE_D_BASE) < 1e-9, \
                f"{fname} PB_AWARE_D_BASE={cs['PB_AWARE_D_BASE']} vs python {PB_AWARE_D_BASE}"
            assert abs(cs["PB_AWARE_D_PEAK"] - PB_AWARE_D_PEAK) < 1e-9, \
                f"{fname} PB_AWARE_D_PEAK={cs['PB_AWARE_D_PEAK']} vs python {PB_AWARE_D_PEAK}"

    def test_pb_aware_sigmoid_params_match(self, js_consts):
        """S 形拐点 + 宽度三处一致."""
        for fname, cs in js_consts.items():
            assert abs(cs["PB_AWARE_CENTER"] - PB_AWARE_CENTER) < 1e-9
            assert abs(cs["PB_AWARE_WIDTH"] - PB_AWARE_WIDTH) < 1e-9
            assert abs(cs["PB_AWARE_STATE_WEIGHT"] - PB_AWARE_STATE_WEIGHT) < 1e-9

    def test_bayesian_prior_params_match(self, js_consts):
        """v2.10.1 贝叶斯先验 (PRIOR_STRENGTH / MIN_OBS) 三处一致."""
        for fname, cs in js_consts.items():
            assert int(cs["PB_AWARE_PRIOR_STRENGTH"]) == PB_AWARE_PRIOR_STRENGTH
            assert int(cs["PB_AWARE_MIN_OBS"]) == PB_AWARE_MIN_OBS

    def test_state_difficulty_weights_match(self, js_consts):
        """老 state_d 公式权重 (fillRate, actionFreedom, trend) 三处一致."""
        for fname, cs in js_consts.items():
            assert abs(cs["FILL_RATE_WEIGHT"] - FILL_RATE_WEIGHT) < 1e-9
            assert abs(cs["ACTION_FREEDOM_WEIGHT"] - ACTION_FREEDOM_WEIGHT) < 1e-9
            assert abs(cs["TREND_WEIGHT"] - TREND_WEIGHT) < 1e-9

    def test_surprise_params_match(self, js_consts):
        """surprise damping / 阈值 / trend 窗口三处一致."""
        for fname, cs in js_consts.items():
            assert abs(cs["SURPRISE_DAMPING"] - SURPRISE_DAMPING) < 1e-9
            assert int(cs["SURPRISE_MIN_CLEARS"]) == SURPRISE_MIN_CLEARS
            assert int(cs["TREND_WINDOW"]) == TREND_WINDOW


# ─────────── 数学公式正确性 (Python 端) ───────────

class TestDPbBaseFormula:
    """v3.0: pb_aware_d_pb_base 是 legacy 函数 (不再参与 d_step 计算),
    仍返回 target_S_curve 用于跨语言一致性测试.
    """

    def test_endpoints(self):
        # r=0 → D_BASE=0.20, r=R_MAX → D_CAP=1.00
        assert abs(pb_aware_d_pb_base(0.0) - 0.20) < 0.01
        assert abs(pb_aware_d_pb_base(2.0) - 1.00) < 0.01

    def test_monotonic(self):
        """全程严格非降 (业务命题: 接近 PB 加压)."""
        prev = pb_aware_d_pb_base(0.0)
        for r in [0.1, 0.3, 0.5, 0.7, 0.85, 1.0, 1.3, 1.7, 2.0]:
            v = pb_aware_d_pb_base(r)
            assert v >= prev - 1e-9, f"非单调 r={r}: {prev} → {v}"
            prev = v

    def test_matches_target_S_curve(self):
        """v2.12: d_pb_base 必须 = target_S_curve."""
        from rl_pytorch.spawn_tuning_v2.target_curve import target_S_curve
        for r in [0.0, 0.3, 0.5, 0.7, 0.85, 1.0, 1.1, 1.5, 2.0]:
            assert pb_aware_d_pb_base(r) == pytest.approx(target_S_curve(r), abs=1e-9)
