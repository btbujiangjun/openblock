"""v1.68 PR3: targetSCurveByArc 跨语言一致性测试.

业务背景
  目标 S 曲线在 web (JS) 与 rl_pytorch (Python) 各有一份实现, 训练时由 Python 端
  生成 d_curve 目标, 客户端 / dashboard 用 JS 端实时绘制. 若两端 ARC_MODIFIERS
  或 target_S_curve_by_arc 实现漂移, 训练的"局间难度"目标和玩家实际体验到的
  曲线会脱节, 模型学不到 arc-aware 行为。

本测试做两件事:
  1. 文本级 grep: JS ARC_MODIFIERS 与 Python ARC_MODIFIERS 数值严格一致.
  2. 锚点表: 针对 (arc, r) 关键点, 提供 Python 端的金标 D 值, 让 JS 测试 (
     tests/tuning/v2/targetSCurve.test.js 内含相同锚点) 与本文件对齐.
"""
from __future__ import annotations
import os
import re
import sys
from pathlib import Path
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from rl_pytorch.spawn_tuning_v2.target_curve import (
    ARC_MODIFIERS,
    target_S_curve_by_arc,
    target_S_curve,
)


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
JS_TARGET = REPO_ROOT / "web" / "src" / "tuning" / "v2" / "targetSCurve.js"


def _extract_js_arc_modifiers(src: str) -> dict:
    """从 JS 源中提取 ARC_MODIFIERS = Object.freeze({...}) 内的 dScale/dShift/brakeShift."""
    # 抓 ARC_MODIFIERS 整块, 然后行级解析
    block_match = re.search(
        r"export\s+const\s+ARC_MODIFIERS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);",
        src,
    )
    if not block_match:
        raise AssertionError("ARC_MODIFIERS 块在 JS 源中未找到 (sync drift?)")
    block = block_match.group(1)
    out: dict = {}
    entry_re = re.compile(
        r"(\w+):\s*\{\s*dScale:\s*([0-9.\-eE]+)\s*,\s*dShift:\s*([0-9.\-eE]+)\s*,\s*brakeShift:\s*([0-9.\-eE]+)\s*\}",
    )
    for m in entry_re.finditer(block):
        out[m.group(1)] = {
            "dScale": float(m.group(2)),
            "dShift": float(m.group(3)),
            "brakeShift": float(m.group(4)),
        }
    return out


class TestArcModifiersConstantsSync:
    """JS 与 Python 的 ARC_MODIFIERS 数值严格一致。"""

    @pytest.fixture(scope="class")
    def js_mods(self):
        if not JS_TARGET.exists():
            pytest.skip(f"{JS_TARGET} 不存在")
        return _extract_js_arc_modifiers(JS_TARGET.read_text(encoding="utf-8"))

    def test_arc_keys_match(self, js_mods):
        assert sorted(js_mods.keys()) == sorted(ARC_MODIFIERS.keys())

    def test_each_arc_values_match(self, js_mods):
        for arc, py_mod in ARC_MODIFIERS.items():
            js_mod = js_mods[arc]
            for k in ("dScale", "dShift", "brakeShift"):
                assert js_mod[k] == pytest.approx(py_mod[k], abs=1e-12), (
                    f"{arc}.{k}: js={js_mod[k]} vs py={py_mod[k]}"
                )


class TestArcAnchorValues:
    """关键 (arc, r) 锚点：Python 计算金标，JS 端测试需复用同值（已在 targetSCurve.test.js 中验证）。"""

    @pytest.mark.parametrize("arc,r", [
        ("opener", 0.5),
        ("opener", 1.0),
        ("opener", 2.0),
        ("momentum", 1.0),
        ("peak", 1.0),
        ("fatigue", 0.5),
        ("fatigue", 0.85),
        ("fatigue", 1.0),
        ("fatigue", 1.3),
        ("cooldown", 0.5),
        ("cooldown", 1.0),
        ("cooldown", 1.5),
    ])
    def test_anchor_value_bounds(self, arc, r):
        v = target_S_curve_by_arc(r, arc)
        assert 0.0 <= v <= 1.0, f"{arc}@r={r} 越界 {v}"

    def test_momentum_peak_equals_base(self):
        for r in [0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 1.5, 2.0]:
            base = target_S_curve(r)
            assert target_S_curve_by_arc(r, "momentum") == pytest.approx(base, abs=1e-12)
            assert target_S_curve_by_arc(r, "peak") == pytest.approx(base, abs=1e-12)

    def test_strict_ordering_at_r_1(self):
        """r=1（接近 PB）时五档难度严格 cooldown < fatigue < opener ≤ momentum = peak。"""
        d = {a: target_S_curve_by_arc(1.0, a) for a in ARC_MODIFIERS.keys()}
        assert d["cooldown"] < d["fatigue"]
        assert d["fatigue"] < d["opener"]
        assert d["opener"] <= d["momentum"] + 1e-12
        assert d["momentum"] == pytest.approx(d["peak"], abs=1e-12)
