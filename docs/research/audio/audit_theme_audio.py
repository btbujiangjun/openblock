#!/usr/bin/env python3
"""Audit generated skin audio overrides against source-pack curation rules."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
RESEARCH = ROOT / "docs" / "research" / "audio"
WEB_BASE = ROOT / "web" / "public" / "audio" / "skins"
MINI_BASE = ROOT / "miniprogram" / "assets" / "audio" / "skins"
AUDIO_EXTS = {".ogg", ".wav", ".mp3", ".m4a"}

HIGH_FREQ_EVENTS = {"place", "tick", "select", "clear"}
REWARD_EVENTS = {"multi", "combo", "perfect", "bonus", "unlock"}
GLOBAL_AVOID = {
    "glitch", "scratch", "error", "click", "tick",
    "bong", "close", "minimize", "back",
    "scream", "hurt", "cough", "burp", "snore",
    "breath", "burble", "spit", "poof", "pfft", "fart", "deflate", "balloon",
}
HIGH_FREQ_AVOID = GLOBAL_AVOID | {"roar", "howl", "monster", "troll", "alien", "grunt", "bark", "barking", "chipscollide", "dicethrow", "diethrow", "dieshuffle"}
REWARD_AVOID = GLOBAL_AVOID | {"scream", "hurt", "cough", "burp", "snore", "breath", "burble", "spit", "poof", "pfft", "fart", "deflate", "balloon", "bark", "barking"}

THEME_RULES = {
    "mahjong": {
        "targets": [
            WEB_BASE / "mahjong",
            WEB_BASE / "_themes" / "mahjong",
            MINI_BASE / "mahjong",
            MINI_BASE / "_groups" / "mahjong",
        ],
        "required_pack": "kenney-casino-audio",
        "allowed": {"cardplace", "cardslide", "chiplay", "chipshandle", "chipsstack", "cardshove"},
        "high_freq_avoid": HIGH_FREQ_AVOID | {"chipscollide", "dice", "die"},
    },
    "jurassic": {
        "targets": [
            WEB_BASE / "jurassic",
            WEB_BASE / "_themes" / "jungle",
            MINI_BASE / "jurassic",
            MINI_BASE / "_groups" / "jungle",
        ],
        "required_pack": "rubberduck-creature-sfx",
        "allowed": {"bug", "cute", "eat", "ooh"},
        "high_freq_avoid": HIGH_FREQ_AVOID,
    },
    "forest": {
        "targets": [
            WEB_BASE / "forest",
            WEB_BASE / "_themes" / "forest",
            MINI_BASE / "forest",
            MINI_BASE / "_groups" / "nature",
        ],
        "required_pack": "rubberduck-creature-sfx",
        "allowed": {"bug", "cute", "ooh"},
        "high_freq_avoid": HIGH_FREQ_AVOID,
    },
    "pets": {
        "targets": [
            WEB_BASE / "pets",
            WEB_BASE / "_themes" / "pet",
            MINI_BASE / "pets",
            MINI_BASE / "_groups" / "cute",
        ],
        "required_pack": "rubberduck-creature-sfx",
        "allowed": {"cute", "nose", "ooh"},
        "high_freq_avoid": HIGH_FREQ_AVOID | {"howl", "monster", "roar", "bark", "barking"},
    },
    "fairy": {
        "targets": [
            WEB_BASE / "fairy",
            WEB_BASE / "_themes" / "fairy",
            WEB_BASE / "fantasy",
            WEB_BASE / "_themes" / "spell",
            MINI_BASE / "fairy",
            MINI_BASE / "fantasy",
            MINI_BASE / "_groups" / "magic",
        ],
        "required_pack": "kenney-interface-sounds",
        "allowed": {"pluck", "glass", "select", "drop"},
        "high_freq_avoid": HIGH_FREQ_AVOID | {"cute", "barking", "howl", "monster", "roar"},
    },
    "water": {
        "targets": [
            WEB_BASE / "ocean",
            WEB_BASE / "koi",
            WEB_BASE / "summer",
            WEB_BASE / "rainyWindow",
            WEB_BASE / "_themes" / "bubble",
            WEB_BASE / "_themes" / "beach",
            WEB_BASE / "_themes" / "koi",
            MINI_BASE / "_groups" / "water",
        ],
        "required_pack": "rubberduck-water-splash-slime",
        "allowed": {"bubble", "splash", "water", "rain"},
        "high_freq_avoid": HIGH_FREQ_AVOID | {"slime"},
    },
    "dark": {
        "targets": [
            WEB_BASE / "demon",
            WEB_BASE / "dungeonLoot",
            WEB_BASE / "_themes" / "underworld",
            MINI_BASE / "demon",
            MINI_BASE / "dungeonLoot",
            MINI_BASE / "_groups" / "dark",
        ],
        "required_pack": None,
        "allowed": {"card", "chip", "cute", "bug"},
        "high_freq_avoid": HIGH_FREQ_AVOID,
    },
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_index() -> dict[str, Path]:
    idx: dict[str, Path] = {}
    for pack_dir in sorted(RESEARCH.iterdir()):
        if not pack_dir.is_dir():
            continue
        for path in sorted(pack_dir.iterdir()):
            if path.suffix.lower() in AUDIO_EXTS:
                idx[digest(path)] = path
    return idx


def event_name(path: Path) -> str:
    return path.stem


def compact_name(path: Path) -> str:
    return path.stem.lower().replace("_", "").replace("-", "")


def audit() -> tuple[list[dict], list[str]]:
    idx = source_index()
    rows: list[dict] = []
    errors: list[str] = []
    for theme, rule in THEME_RULES.items():
        for target in rule["targets"]:
            files = sorted(p for p in target.glob("*") if p.suffix.lower() in AUDIO_EXTS)
            if not files:
                errors.append(f"{theme}: missing mapped files in {target.relative_to(ROOT)}")
                continue
            for out in files:
                src = idx.get(digest(out))
                row = {
                    "theme": theme,
                    "target": str(out.relative_to(ROOT)),
                    "event": event_name(out),
                    "source": str(src.relative_to(ROOT)) if src else None,
                }
                rows.append(row)
                if not src:
                    errors.append(f"{theme}: unknown source for {out.relative_to(ROOT)}")
                    continue
                pack = src.parent.name
                name = compact_name(src)
                event = event_name(out)
                if rule["required_pack"] and pack != rule["required_pack"]:
                    errors.append(f"{theme}: {out.relative_to(ROOT)} expected {rule['required_pack']}, got {pack}")
                if event in HIGH_FREQ_EVENTS:
                    bad = sorted(t for t in rule["high_freq_avoid"] if t in name)
                    if bad:
                        errors.append(f"{theme}: high-frequency {out.relative_to(ROOT)} uses {src.name} ({','.join(bad)})")
                if event in REWARD_EVENTS:
                    bad = sorted(t for t in REWARD_AVOID if t in name)
                    if bad:
                        errors.append(f"{theme}: reward {out.relative_to(ROOT)} uses {src.name} ({','.join(bad)})")
                if not any(t in name for t in rule["allowed"]):
                    errors.append(f"{theme}: {out.relative_to(ROOT)} source {src.name} is not theme-allowed")
    errors.extend(audit_programmatic_brightness())
    return rows, errors


def audit_programmatic_brightness() -> list[str]:
    errors: list[str] = []
    web_palette = ROOT / "web" / "src" / "effects" / "skinSoundPalettes.js"
    mini_audio = ROOT / "miniprogram" / "utils" / "audioFx.js"
    web_src = web_palette.read_text()
    mini_src = mini_audio.read_text()
    if "filter: 'lowpass'" in web_src:
        errors.append("programmatic: web skin palettes must not use lowpass impact layers for themed rewards")
    if "_playArp" in web_src:
        errors.append("programmatic: web skin palettes must not use arpeggio helpers")
    for token in ("confirmation_", "open_"):
        if token in (RESEARCH / "theme_audio_mapping_manifest.json").read_text():
            errors.append(f"mapping: generated manifest still contains arpeggio-like source token {token!r}")
    dull_sweeps = [" : 0.45", " : 0.55", " : 0.28", " : 0.5)"]
    for token in dull_sweeps:
        if token in mini_src:
            errors.append(f"programmatic: miniprogram themed rewards still contain dull downward sweep token {token!r}")
    if "barking_" in (RESEARCH / "theme_audio_mapping_manifest.json").read_text():
        errors.append("mapping: generated manifest still contains barking source")
    return errors


def main() -> int:
    rows, errors = audit()
    report = {
        "checked_files": len(rows),
        "errors": errors,
        "rows": rows,
    }
    out = RESEARCH / "theme_audio_audit_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if errors:
        print("\n".join(errors))
        print(f"audit failed; report: {out.relative_to(ROOT)}")
        return 1
    print(f"theme audio audit passed ({len(rows)} files); report: {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
