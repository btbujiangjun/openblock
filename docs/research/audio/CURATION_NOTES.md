OpenBlock research audio imports

Kenney Interface Sounds, CC0 1.0, https://kenney.nl/assets/interface-sounds
Kenney UI Audio, CC0 1.0, https://kenney.nl/assets/ui-audio
Kenney Casino Audio, CC0 1.0, https://kenney.nl/assets/casino-audio
rubberduck Water/Splash/Slime SFX, CC0, https://opengameart.org/content/40-cc0-water-splash-slime-sfx
rubberduck Creature SFX, CC0, https://opengameart.org/content/80-cc0-creature-sfx

Usage: research/test audio overrides. Replace before production if project policy requires curated assets.
Generated mapping policy:
- Global target: sounds should be crisp, bright, and pleasant. Prefer short pluck/glass/card/tile/bubble/cute cues with clear attack, light high-frequency sparkle, and upward motion. Avoid dull lowpass impacts, long air hiss, creature roughness, and low descending sweeps.
- Mahjong uses soft table-object sounds from Kenney Casino: cardPlace, cardSlide, chipLay, chipsStack, and chipsHandle. Do not use chipsCollide, diceThrow, dieThrow, dieShuffle, or generic UI click/tick for frequent feedback.
- Jurassic and forest are separated. Jurassic uses soft jungle/wood/leaf/creature-adjacent sounds; forest uses leaf/bug/cute/ooh-style cues. Do not use howl, monster, roar, scream, hurt, cough, burp, snore, breath, burble, spit, poof, pfft, fart, deflate, misc, barking, or balloon-like sounds for frequent or reward feedback.
- Pets use cute/nose/ooh-like sources only. Avoid bark, barking, howl, monster, and roar.
- Fairy, fantasy, and magic themes use clean pluck/glass/select/drop UI tones only. Do not use confirmation/open arpeggio cues, barking, cute creature voices, long air hiss, or any animal-like sources for magic place/tick/select/clear feedback.
- Avoid arpeggio-style feedback globally: no separated ascending note ladders, no score-lift arps, and no external sources that behave like stepwise UI success jingles.
- Water/Ocean/Koi/Summer/RainyWindow use bubble/splash/water/rain SFX. Do not use slime for regular place/tick/select/clear feedback.
- Dark skins keep tension through tactile table/object sounds and brighter minor upward motion. Do not use low closing stingers or hoarse creature sounds as high-frequency feedback.
- Excludes harsh, hoarse, or balloon-deflate-like tokens: glitch/scratch/error/bong/close/minimize/back/scream/hurt/burp/cough/snore/breath/burble/spit/poof/pfft/fart/deflate/balloon/click/tick, plus theme-specific bans checked by `audit_theme_audio.py`.
- External files are research overrides; code falls back to procedural SFX when missing or disabled.
- Current theme remap manifest: `theme_audio_mapping_manifest.json`; latest audit output: `theme_audio_audit_report.json`.
