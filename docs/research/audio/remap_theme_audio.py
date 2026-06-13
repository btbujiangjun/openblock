#!/usr/bin/env python3
"""Regenerate theme-relevant audio overrides for Web and Miniprogram."""

from __future__ import annotations

import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
RESEARCH = ROOT / "docs" / "research" / "audio"
WEB_BASE = ROOT / "web" / "public" / "audio" / "skins"
MINI_BASE = ROOT / "miniprogram" / "assets" / "audio" / "skins"
AUDIO_EXTS = {".ogg", ".wav", ".mp3", ".m4a"}

CASINO = RESEARCH / "kenney-casino-audio"
WATER = RESEARCH / "rubberduck-water-splash-slime"
CREATURE = RESEARCH / "rubberduck-creature-sfx"
INTERFACE = RESEARCH / "kenney-interface-sounds"

WEB_EVENTS = ["place", "clear", "multi", "combo", "perfect", "bonus", "unlock", "tick"]
MINI_EVENTS = WEB_EVENTS + ["select", "gameOver"]


def src(pack: Path, name: str) -> Path:
    path = pack / name
    if not path.exists():
        raise FileNotFoundError(path)
    return path


PROFILES = {
    # Mahjong: soft table-card/chip-lay sounds only. No chipsCollide or dice throws.
    "mahjong": {
        "pack": "kenney-casino-audio",
        "events": {
            "place": src(CASINO, "cardPlace1.ogg"),
            "tick": src(CASINO, "chipLay1.ogg"),
            "select": src(CASINO, "cardSlide1.ogg"),
            "clear": src(CASINO, "cardSlide3.ogg"),
            "multi": src(CASINO, "chipsStack1.ogg"),
            "combo": src(CASINO, "chipsStack2.ogg"),
            "perfect": src(CASINO, "chipsStack4.ogg"),
            "bonus": src(CASINO, "chipsStack5.ogg"),
            "unlock": src(CASINO, "chipsHandle1.ogg"),
            "gameOver": src(CASINO, "cardShove1.ogg"),
        },
    },
    # Jurassic: small jungle/creature texture, no screams/roars/howls.
    "jurassic": {
        "pack": "rubberduck-creature-sfx",
        "events": {
            "place": src(CREATURE, "bug_01.ogg"),
            "tick": src(CREATURE, "cute_01.ogg"),
            "select": src(CREATURE, "cute_02.ogg"),
            "clear": src(CREATURE, "cute_05.ogg"),
            "multi": src(CREATURE, "bug_03.ogg"),
            "combo": src(CREATURE, "cute_06.ogg"),
            "perfect": src(CREATURE, "cute_08.ogg"),
            "bonus": src(CREATURE, "cute_09.ogg"),
            "unlock": src(CREATURE, "ooh.ogg"),
            "gameOver": src(CREATURE, "cute_10.ogg"),
        },
    },
    "forest": {
        "pack": "rubberduck-creature-sfx",
        "events": {
            "place": src(CREATURE, "bug_02.ogg"),
            "tick": src(CREATURE, "cute_03.ogg"),
            "select": src(CREATURE, "cute_04.ogg"),
            "clear": src(CREATURE, "cute_08.ogg"),
            "multi": src(CREATURE, "bug_04.ogg"),
            "combo": src(CREATURE, "cute_07.ogg"),
            "perfect": src(CREATURE, "cute_08.ogg"),
            "bonus": src(CREATURE, "cute_09.ogg"),
            "unlock": src(CREATURE, "ooh.ogg"),
            "gameOver": src(CREATURE, "cute_10.ogg"),
        },
    },
    "pets": {
        "pack": "rubberduck-creature-sfx",
        "events": {
            "place": src(CREATURE, "cute_01.ogg"),
            "tick": src(CREATURE, "cute_02.ogg"),
            "select": src(CREATURE, "nose.ogg"),
            "clear": src(CREATURE, "cute_04.ogg"),
            "multi": src(CREATURE, "cute_06.ogg"),
            "combo": src(CREATURE, "cute_07.ogg"),
            "perfect": src(CREATURE, "cute_09.ogg"),
            "bonus": src(CREATURE, "cute_10.ogg"),
            "unlock": src(CREATURE, "ooh.ogg"),
            "gameOver": src(CREATURE, "cute_08.ogg"),
        },
    },
    # Fairy/magic: clear pluck/glass UI tones, no creature or pet-like voices.
    "magic": {
        "pack": "kenney-interface-sounds",
        "events": {
            "place": src(INTERFACE, "pluck_001.wav"),
            "tick": src(INTERFACE, "pluck_002.wav"),
            "select": src(INTERFACE, "select_006.wav"),
            "clear": src(INTERFACE, "glass_002.wav"),
            "multi": src(INTERFACE, "glass_003.wav"),
            "combo": src(INTERFACE, "glass_004.wav"),
            "perfect": src(INTERFACE, "glass_005.wav"),
            "bonus": src(INTERFACE, "glass_006.wav"),
            "unlock": src(INTERFACE, "drop_002.wav"),
            "gameOver": src(INTERFACE, "drop_001.wav"),
        },
    },
    "water": {
        "pack": "rubberduck-water-splash-slime",
        "events": {
            "place": src(WATER, "bubble_01.ogg"),
            "tick": src(WATER, "bubble_02.ogg"),
            "select": src(WATER, "bubble_03.ogg"),
            "clear": src(WATER, "splash_03.ogg"),
            "multi": src(WATER, "splash_06.ogg"),
            "combo": src(WATER, "splash_09.ogg"),
            "perfect": src(WATER, "splash_12.ogg"),
            "bonus": src(WATER, "splash_14.ogg"),
            "unlock": src(WATER, "loop_water_01.ogg"),
            "gameOver": src(WATER, "loop_rain.ogg"),
        },
    },
    # Dark skins use tactile table/object sounds, not creature growls.
    "dark": {
        "pack": "kenney-casino-audio",
        "events": {
            "place": src(CASINO, "cardPlace2.ogg"),
            "tick": src(CASINO, "chipLay2.ogg"),
            "select": src(CASINO, "cardSlide2.ogg"),
            "clear": src(CASINO, "cardShove2.ogg"),
            "multi": src(CASINO, "chipsStack2.ogg"),
            "combo": src(CASINO, "chipsStack3.ogg"),
            "perfect": src(CASINO, "chipsHandle4.ogg"),
            "bonus": src(CASINO, "chipsHandle5.ogg"),
            "unlock": src(CASINO, "chipsHandle6.ogg"),
            "gameOver": src(CASINO, "cardShove3.ogg"),
        },
    },
}

TARGETS = [
    ("mahjong", WEB_BASE / "mahjong", WEB_EVENTS),
    ("mahjong", WEB_BASE / "_themes" / "mahjong", WEB_EVENTS),
    ("mahjong", MINI_BASE / "mahjong", MINI_EVENTS),
    ("mahjong", MINI_BASE / "_groups" / "mahjong", MINI_EVENTS),
    ("jurassic", WEB_BASE / "jurassic", WEB_EVENTS),
    ("jurassic", WEB_BASE / "_themes" / "jungle", WEB_EVENTS),
    ("jurassic", MINI_BASE / "jurassic", MINI_EVENTS),
    ("jurassic", MINI_BASE / "_groups" / "jungle", MINI_EVENTS),
    ("forest", WEB_BASE / "forest", WEB_EVENTS),
    ("forest", WEB_BASE / "_themes" / "forest", WEB_EVENTS),
    ("forest", MINI_BASE / "forest", MINI_EVENTS),
    ("forest", MINI_BASE / "_groups" / "nature", MINI_EVENTS),
    ("pets", WEB_BASE / "pets", WEB_EVENTS),
    ("pets", WEB_BASE / "_themes" / "pet", WEB_EVENTS),
    ("pets", MINI_BASE / "pets", MINI_EVENTS),
    ("pets", MINI_BASE / "_groups" / "cute", MINI_EVENTS),
    ("magic", WEB_BASE / "fairy", WEB_EVENTS),
    ("magic", WEB_BASE / "_themes" / "fairy", WEB_EVENTS),
    ("magic", WEB_BASE / "fantasy", WEB_EVENTS),
    ("magic", WEB_BASE / "_themes" / "spell", WEB_EVENTS),
    ("magic", MINI_BASE / "fairy", MINI_EVENTS),
    ("magic", MINI_BASE / "fantasy", MINI_EVENTS),
    ("magic", MINI_BASE / "_groups" / "magic", MINI_EVENTS),
    ("water", WEB_BASE / "ocean", WEB_EVENTS),
    ("water", WEB_BASE / "koi", WEB_EVENTS),
    ("water", WEB_BASE / "summer", WEB_EVENTS),
    ("water", WEB_BASE / "rainyWindow", WEB_EVENTS),
    ("water", WEB_BASE / "_themes" / "bubble", WEB_EVENTS),
    ("water", WEB_BASE / "_themes" / "beach", WEB_EVENTS),
    ("water", WEB_BASE / "_themes" / "koi", WEB_EVENTS),
    ("water", MINI_BASE / "_groups" / "water", MINI_EVENTS),
    ("dark", WEB_BASE / "demon", WEB_EVENTS),
    ("dark", WEB_BASE / "dungeonLoot", WEB_EVENTS),
    ("dark", WEB_BASE / "_themes" / "underworld", WEB_EVENTS),
    ("dark", MINI_BASE / "demon", MINI_EVENTS),
    ("dark", MINI_BASE / "dungeonLoot", MINI_EVENTS),
    ("dark", MINI_BASE / "_groups" / "dark", MINI_EVENTS),
]


def clear_audio_files(target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for path in target.iterdir():
        if path.suffix.lower() in AUDIO_EXTS:
            path.unlink()


def copy_event(source: Path, target: Path, event: str) -> Path:
    out = target / f"{event}{source.suffix.lower()}"
    shutil.copyfile(source, out)
    return out


def main() -> int:
    rows = []
    for profile_name, target, events in TARGETS:
        profile = PROFILES[profile_name]
        clear_audio_files(target)
        for event in events:
            source = profile["events"][event]
            out = copy_event(source, target, event)
            rows.append({
                "profile": profile_name,
                "target": str(target.relative_to(ROOT)),
                "event": event,
                "source_pack": source.parent.name,
                "source_file": source.name,
                "output": str(out.relative_to(ROOT)),
            })
    out = RESEARCH / "theme_audio_mapping_manifest.json"
    out.write_text(json.dumps({
        "policy": "theme-related, non-harsh remap for high-frequency and reward feedback",
        "rows": rows,
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"remapped {len(rows)} files; manifest: {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
