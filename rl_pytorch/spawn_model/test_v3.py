"""SpawnTransformerV3 + 配套模块 单元自检。

运行：
  python -m rl_pytorch.spawn_model.test_v3
"""

from __future__ import annotations

import sys

import numpy as np
import torch


def test_feasibility():
    from .feasibility import (
        check_shape_feasibility,
        count_feasible_positions,
        build_feasibility_mask,
        build_feasibility_weight,
        apply_feasibility_mask_torch,
    )

    empty = np.zeros((8, 8), dtype=np.int8)
    full = np.ones((8, 8), dtype=np.int8)
    L = [[1, 0], [1, 0], [1, 1]]

    assert check_shape_feasibility(empty, L) is True, "L 在空盘应可放"
    assert check_shape_feasibility(full, L) is False, "L 在满盘不应可放"

    n_empty = count_feasible_positions(empty, L)
    expected = (8 - 3 + 1) * (8 - 2 + 1)
    assert n_empty == expected, f"空盘 L 落点数应为 {expected}，实际 {n_empty}"
    assert count_feasible_positions(full, L) == 0

    vocab = ['a', 'b', 'c']
    smap = {
        'a': [[1]],                    # 1×1，处处可放
        'b': [[1, 1, 1, 1, 1, 1, 1, 1, 1]],  # 9 列宽，超出 8 → 不可放
        'c': L,
    }
    mask = build_feasibility_mask(empty, vocab, smap)
    assert mask.tolist() == [1.0, 0.0, 1.0]
    weight = build_feasibility_weight(empty, vocab, smap, normalize='max')
    assert weight[0] == 1.0 and weight[1] == 0.0 and 0 < weight[2] <= 1.0

    logits = torch.zeros(1, 3)
    masked = apply_feasibility_mask_torch(logits, mask)
    assert masked[0, 1].item() < -100, "不可放位置应被压低 logit"

    print("[OK] feasibility")


def test_v3_forward_and_sample():
    from .model_v3 import SpawnTransformerV3, NUM_PLAYSTYLES, PLAYSTYLE_TO_IDX
    from .dataset import BEHAVIOR_CONTEXT_DIM

    model = SpawnTransformerV3()
    model.eval()

    B = 2
    board = torch.zeros(B, 8, 8)
    ctx = torch.zeros(B, BEHAVIOR_CONTEXT_DIM)
    history = torch.zeros(B, 3, 3, dtype=torch.long)
    target_diff = torch.tensor([[0.3], [0.7]])
    playstyle = torch.tensor([
        PLAYSTYLE_TO_IDX['perfect_hunter'],
        PLAYSTYLE_TO_IDX['survival'],
    ])
    prev = torch.tensor([[0, 1], [2, 3]], dtype=torch.long)

    out = model(board, ctx, history, target_diff,
                playstyle_id=playstyle, prev_shapes=prev)

    assert isinstance(out, dict)
    l0, l1, l2 = out['logits']
    assert l0.shape == (B, 28) and l1.shape == (B, 28) and l2.shape == (B, 28)
    assert out['feas_logits'].shape == (B, 28)
    assert out['style_logits'].shape == (B, NUM_PLAYSTYLES)
    assert out['intent_logits'].shape == (B, 6)
    assert out['div_logits'].shape == (B, 3, 7)

    sample_board = torch.zeros(1, 8, 8)
    sample_ctx = torch.zeros(1, BEHAVIOR_CONTEXT_DIM)
    sample_hist = torch.zeros(1, 3, 3, dtype=torch.long)

    triplet = model.sample(sample_board, sample_ctx, sample_hist,
                           target_difficulty=0.5, playstyle='balanced')
    assert len(triplet) == 3
    assert len(set(triplet)) == 3, f"不应有重复 shape: {triplet}"

    fmask = np.zeros(28, dtype=np.float32)
    keep = [0, 1, 2, 3, 4]
    for i in keep:
        fmask[i] = 1.0
    triplet2 = model.sample(sample_board, sample_ctx, sample_hist,
                            feasibility_mask=fmask, playstyle='combo')
    assert all(s in keep for s in triplet2), \
        f"feasibility_mask 应限制采样，实际 {triplet2}"

    print("[OK] V3 forward + sample + feasibility_mask")


def test_lora_inject_and_save_load():
    from .lora import (
        inject_lora_into_model,
        freeze_non_lora,
        lora_parameters,
        lora_state_dict,
        load_lora_state_dict,
        count_lora_params,
    )
    from .model_v3 import SpawnTransformerV3

    model = SpawnTransformerV3()
    base_params = sum(p.numel() for p in model.parameters())

    n_replaced = inject_lora_into_model(model, r=4, alpha=8)
    assert n_replaced > 0, "应至少替换一个 head"

    freeze_non_lora(model)
    n_lora = count_lora_params(model)
    n_train = sum(p.numel() for p in model.parameters() if p.requires_grad)
    assert n_lora == n_train, "冻结后应仅 LoRA 可训"
    print(f"  trunk={base_params:,} / LoRA={n_lora:,} (~{n_lora/base_params*100:.1f}%)")

    sd = lora_state_dict(model)
    assert all(('lora_A' in k or 'lora_B' in k) for k in sd.keys())
    for k, v in sd.items():
        with torch.no_grad():
            for p in model.parameters():
                pass
            for name, p in model.named_parameters():
                if name == k:
                    p.zero_()
                    break

    n_loaded = load_lora_state_dict(model, sd, strict=True)
    assert n_loaded == len(sd), "全部 LoRA 张量都应能装回"

    print("[OK] LoRA inject / freeze / save / load")


def test_shape_proposer():
    from .shape_proposer import (
        propose_shape,
        propose_unique_batch,
        shape_signature,
        score_shape,
    )

    s1 = propose_shape(n_cells=4, seed=42)
    arr = np.asarray(s1, dtype=int)
    assert arr.sum() == 4, f"应有 4 个格子，实际 {arr.sum()}"
    assert arr.shape[0] <= 4 and arr.shape[1] <= 4
    print(f"  示例形状(4格): {s1}")

    sig_a = shape_signature(s1)
    s1_rot = np.rot90(arr).tolist()
    sig_b = shape_signature(s1_rot)
    assert sig_a == sig_b, "旋转后签名应相同"

    batch = propose_unique_batch(n=8, seed=123)
    sigs = {b['sig'] for b in batch}
    assert len(sigs) == len(batch), "批量结果应去重"
    for b in batch:
        sc = b['score']
        assert sc['cells'] in (3, 4, 5)

    score = score_shape([[1, 1], [1, 1]])
    assert score['boxiness'] == 1.0 and score['elongation'] == 1.0
    print("[OK] shape_proposer")


def test_train_v3_helpers():
    from .train_v3 import (
        soft_infeasible_loss,
        feasibility_bce_loss,
        style_ce_loss,
        intent_ce_loss,
        _infer_playstyle_from_context,
        _infer_intent_from_behavior_context,
    )
    from .dataset import BEHAVIOR_CONTEXT_DIM

    B, S = 2, 28
    logits = (torch.randn(B, S), torch.randn(B, S), torch.randn(B, S))
    feas_mask = torch.zeros(B, S)
    feas_mask[:, :10] = 1.0

    si = soft_infeasible_loss(logits, feas_mask)
    assert si.item() > 0 and torch.isfinite(si)

    feas_logits = torch.randn(B, S)
    bce = feasibility_bce_loss(feas_logits, feas_mask)
    assert bce.item() > 0

    style_logits = torch.randn(B, 5)
    style_targets = torch.tensor([0, 2])
    sce = style_ce_loss(style_logits, style_targets)
    assert sce.item() > 0

    intent_logits = torch.randn(B, 6)
    intent_targets = torch.tensor([0, 5])
    ice = intent_ce_loss(intent_logits, intent_targets)
    assert ice.item() > 0

    ctx = torch.zeros(B, BEHAVIOR_CONTEXT_DIM)
    ctx[0, 12] = 0.1  # clear_rate 低 → survival
    ctx[1, 14] = 0.5  # combo_rate 高 → multi_clear
    ctx[0, 48] = 1.0  # relief
    ctx[1, 52] = 1.0  # flow
    ps = _infer_playstyle_from_context(ctx)
    assert ps[0].item() == 4  # survival
    assert ps[1].item() == 2  # multi_clear
    intents = _infer_intent_from_behavior_context(ctx)
    assert intents[0].item() == 0
    assert intents[1].item() == 4

    print("[OK] train_v3 helpers")


def main():
    tests = [
        test_feasibility,
        test_v3_forward_and_sample,
        test_lora_inject_and_save_load,
        test_shape_proposer,
        test_train_v3_helpers,
    ]
    failed = 0
    for t in tests:
        try:
            t()
        except Exception as e:
            print(f"[FAIL] {t.__name__}: {e}")
            failed += 1
            import traceback
            traceback.print_exc()
    if failed:
        print(f"\n{failed}/{len(tests)} 个测试失败")
        sys.exit(1)
    print(f"\n全部 {len(tests)} 项 V3 自检通过")


if __name__ == '__main__':
    main()
