OpenBlock research audio imports

Kenney Interface Sounds, CC0 1.0, https://kenney.nl/assets/interface-sounds
Kenney UI Audio, CC0 1.0, https://kenney.nl/assets/ui-audio
Kenney Casino Audio, CC0 1.0, https://kenney.nl/assets/casino-audio
rubberduck Water/Splash/Slime SFX, CC0, https://opengameart.org/content/40-cc0-water-splash-slime-sfx
rubberduck Creature SFX, CC0, https://opengameart.org/content/80-cc0-creature-sfx
hernandack Short Loops Background Music Pack, freely usable research BGM, https://opengameart.org/content/short-loops-background-music-pack

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

PB chase cue research import:
- Purpose: game-level personal-best chase motif, independent of skins.
- v1.71 note: the old long loop BGM files were replaced by ~3.05s short WAV cues
  sourced from OpenGameArt research audio. The cue plays once when entering a PB
  phase instead of looping while the phase persists.
- Runtime mapping:
  - `pb_near.wav` <- OpenGameArt `simple_battle_fanfare.wav` from "Simple Battle Fanfare"
    (`https://opengameart.org/content/simple-battle-fanfare`, CC0 notice: "do whatever you want with it").
    Trimmed/faded to 3.05s; plays once at 80%-95% of run-start PB.
  - `pb_sprint.wav` <- OpenGameArt `Heavy_ConceptB.wav` from "Victory Fanfare Short"
    (`https://opengameart.org/content/victory-fanfare-short`, listed in OpenGameArt CC0 audio collection).
    Trimmed/faded to 3.05s; plays once at 95%-100% of run-start PB.
  - `pb_release.wav` <- OpenGameArt `fanfare1.wav` from "Victory Fanfare"
    (`https://opengameart.org/content/victory-fanfare`, OpenGameArt commercial-use-OK listing).
    Trimmed/faded to 3.05s; plays once after breaking run-start PB.
- Bundled paths:
  - Web: `web/public/audio/game/pb_chase/`
  - Mini Program: `miniprogram/assets/audio/game/pb_chase/`
  - Cocos: `cocos/assets/resources/audio/game/pb_chase/`
- Processing policy: source files are network-downloaded research assets; local processing is limited to
  trimming the head segment, applying a short fade-out, and normalizing to 44.1kHz/16-bit/stereo WAV.
  No melody is synthesized locally.
- Policy: these are research validation files. Replace with commissioned or final licensed masters before production if product policy requires exclusive music identity.
