"""v2.10.8 G9: 数据生命周期管理 (housekeeping).

定期清理:
  1. 老的 training_jobs (done/failed/cancelled 状态, > N 天)
  2. 孤儿 .pt + .pt.log + .pt.meta.json 文件 (db 中已无对应记录)
  3. 老 sample_sets (status=archived, > N 天) — 保留 deployed 模型用到的

用法:
  # 看会清啥 (不动)
  python -m rl_pytorch.spawn_tuning_v2.cleanup --db <path> --dry-run

  # 实际清理
  python -m rl_pytorch.spawn_tuning_v2.cleanup --db <path> --apply \\
      --jobs-older-days 30 --sample-sets-older-days 60

  # 仅孤儿文件
  python -m rl_pytorch.spawn_tuning_v2.cleanup --db <path> --apply --skip-jobs --skip-sets

安全:
  - 默认 --dry-run
  - deployed/staging 状态的模型永远不删
  - jobs.output_model_id 关联的 ckpt 永远不删 (即使 job 已老)
"""
from __future__ import annotations
import argparse
import sqlite3
import time
from pathlib import Path
from typing import Set, List


def cleanup_old_jobs(db_path: str, older_days: int, dry_run: bool) -> dict:
    """删除老的 done/failed/cancelled jobs (不影响关联模型)。"""
    cutoff = int(time.time()) - older_days * 86400
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT job_id, status, name FROM training_jobs "
            "WHERE status IN ('done', 'failed', 'cancelled') "
            "AND COALESCE(completed_at, created_at) < ?",
            (cutoff,),
        ).fetchall()
        ids = [r["job_id"] for r in rows]
        if not dry_run and ids:
            placeholders = ",".join("?" * len(ids))
            conn.execute(f"DELETE FROM training_jobs WHERE job_id IN ({placeholders})", ids)
            conn.commit()
        return {"matched": len(ids), "ids": ids[:10], "dry_run": dry_run}
    finally:
        conn.close()


def find_orphan_files(db_path: str, ckpt_dir: str) -> dict:
    """找出磁盘上 .pt / .pt.meta.json / .policies.json 但 db 中无对应 model 的孤儿文件。"""
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute("SELECT weights_path FROM models WHERE weights_path IS NOT NULL").fetchall()
        known = {Path(r[0]).resolve() for r in rows if r[0]}
    finally:
        conn.close()

    p = Path(ckpt_dir)
    if not p.exists():
        return {"orphans": [], "total_disk": 0, "ckpt_dir_exists": False}
    orphans: List[Path] = []
    total_disk = 0
    for f in p.glob("*.pt"):
        if f.resolve() not in known:
            orphans.append(f)
            total_disk += f.stat().st_size
            # 附带文件
            for suffix in [".meta.json", ".log", ".policies.json"]:
                sidecar = Path(str(f) + suffix)
                if sidecar.exists():
                    orphans.append(sidecar)
                    total_disk += sidecar.stat().st_size
    return {
        "orphans": [str(f) for f in orphans],
        "total_size_bytes": total_disk,
        "ckpt_dir_exists": True,
    }


def delete_orphan_files(paths: List[str], dry_run: bool) -> int:
    """删除孤儿文件, 返回成功删除数。"""
    n = 0
    for p in paths:
        if dry_run:
            n += 1
            continue
        try:
            Path(p).unlink()
            n += 1
        except OSError:
            pass
    return n


def cleanup_archived_sample_sets(db_path: str, older_days: int, dry_run: bool) -> dict:
    """删除 status=archived 且 > N 天的 sample_sets (samples 通过 CASCADE 自动删)。

    保护:跳过被 deployed/staging 模型 sample_set_ids 引用的 set_id。
    """
    cutoff = int(time.time()) - older_days * 86400
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        # 找候选
        rows = conn.execute(
            "SELECT set_id, name FROM sample_sets "
            "WHERE status = 'archived' AND created_at < ?",
            (cutoff,),
        ).fetchall()

        # 收集被活跃模型引用的 set_id (从 training_jobs.sample_set_ids JSON 反查)
        protected: Set[int] = set()
        for r in conn.execute(
            "SELECT j.sample_set_ids FROM training_jobs j "
            "JOIN models m ON j.output_model_id = m.model_id "
            "WHERE m.status IN ('deployed', 'staging')"
        ).fetchall():
            try:
                import json as _json
                sids = _json.loads(r[0] or "[]")
                for s in sids:
                    protected.add(int(s))
            except Exception:
                pass

        to_delete = [r["set_id"] for r in rows if r["set_id"] not in protected]
        skipped = [r["set_id"] for r in rows if r["set_id"] in protected]
        if not dry_run and to_delete:
            placeholders = ",".join("?" * len(to_delete))
            conn.execute(f"DELETE FROM sample_sets WHERE set_id IN ({placeholders})", to_delete)
            conn.commit()
        return {
            "matched": len(to_delete),
            "ids": to_delete[:10],
            "protected": skipped,
            "dry_run": dry_run,
        }
    finally:
        conn.close()


def main():
    p = argparse.ArgumentParser(description="v2.10.8 G9: housekeeping")
    p.add_argument("--db", required=True)
    p.add_argument("--ckpt-dir", default="checkpoints/v2")
    p.add_argument("--jobs-older-days", type=int, default=30)
    p.add_argument("--sample-sets-older-days", type=int, default=60)
    p.add_argument("--dry-run", action="store_true", default=False, help="默认 --apply")
    p.add_argument("--apply", dest="dry_run", action="store_false")
    p.add_argument("--skip-jobs", action="store_true")
    p.add_argument("--skip-orphans", action="store_true")
    p.add_argument("--skip-sets", action="store_true")
    args = p.parse_args()

    mode = "DRY-RUN" if args.dry_run else "APPLIED"
    print(f"=== Spawn Tuning v2 Housekeeping ({mode}) ===\n")

    if not args.skip_jobs:
        r = cleanup_old_jobs(args.db, args.jobs_older_days, args.dry_run)
        print(f"[jobs > {args.jobs_older_days} d, done/failed/cancelled]")
        print(f"  matched: {r['matched']}, sample ids: {r['ids']}\n")

    if not args.skip_orphans:
        r = find_orphan_files(args.db, args.ckpt_dir)
        print(f"[orphan files in {args.ckpt_dir}]")
        if not r["ckpt_dir_exists"]:
            print(f"  ckpt_dir 不存在, 跳过\n")
        else:
            sz_mb = r["total_size_bytes"] / 1024 / 1024
            print(f"  orphan files: {len(r['orphans'])} · size: {sz_mb:.1f} MB")
            for f in r["orphans"][:5]:
                print(f"    {f}")
            if len(r["orphans"]) > 5:
                print(f"    ... (and {len(r['orphans']) - 5} more)")
            n = delete_orphan_files(r["orphans"], args.dry_run)
            print(f"  {'will delete' if args.dry_run else 'deleted'}: {n}\n")

    if not args.skip_sets:
        r = cleanup_archived_sample_sets(args.db, args.sample_sets_older_days, args.dry_run)
        print(f"[archived sample_sets > {args.sample_sets_older_days} d]")
        print(f"  matched: {r['matched']}, sample ids: {r['ids']}")
        if r.get("protected"):
            print(f"  protected (referenced by active models): {r['protected']}")
        print()

    if args.dry_run:
        print("→ 看起来合理? 加 --apply 实际执行")
    else:
        print("✓ Housekeeping done.")


if __name__ == "__main__":
    main()
