OpenBlock skin asset research notes

This file records sources used as visual references for the 12-theme skin expansion.
The current implementation uses project-local SVG UI icon files as the primary block
visuals for these skins. Emoji/symbol values remain in `blockIcons` only as gameplay
ids and fallback text when an external UI asset fails to load.

## Research-Stage Source Policy

- Kenney assets: CC0 1.0. Useful for classic game UI, arcade panels, toy-like UI shapes, and interface framing.
- OpenGameArt: mixed licenses. Use only item-level CC0 or explicitly documented permissive assets for production.
- Noto Emoji: SIL OFL 1.1 / Apache 2.0 depending on asset type. Safe as a style reference; do not copy platform-specific emoji art.
- Material Symbols: Apache 2.0. Good reference for functional UI shapes, circuits, docks, and control panels.
- Tabler / Iconoir / Lucide: MIT or ISC-style permissive licenses. Good references for line icon language.
- Poly Haven / ambientCG: CC0. Good material references for stone, paper, metal, glass, wood, rain, and mineral palettes.
- Game-icons.net: mostly CC BY. Useful for research, but production use requires attribution and license tracking.

## New Skin Themes

- `arcadeCabinet`: classic arcade UI, CRT panels, coin-op labels.
- `circuitBoard`: PCB traces, signal nodes, electronic diagnostic lights.
- `toyBox`: toy blocks, puzzles, playground objects.
- `mineralCave`: gemstones, mineral strata, mine lamps.
- `alchemyLab`: potion bottles, lab glass, parchment, copper-green surfaces.
- `botanicalStudy`: herbarium paper, plant tags, muted greenhouse colors.
- `spaceDock`: orbital docks, hangar lights, ion-blue UI.
- `dungeonLoot`: dungeon props, treasure crates, old-stone rooms.
- `origamiPaper`: folded paper, paper labels, calm soft-color craft language.
- `museumRelic`: vitrines, relic labels, bronze and clay artifacts.
- `winterCabin`: snow-window warmth, wool, wood, hearth tones.
- `rainyWindow`: rainy glass, streetlight reflections, soft blue-gray night.

## Implemented Local UI Assets

- Web assets live under `web/public/assets/skins/<skinId>/block-0.svg` ... `block-7.svg`.
- Miniprogram assets live under `miniprogram/assets/skins/<skinId>/block-0.svg` ... `block-7.svg`.
- `web/src/skins.js` declares these paths via `blockIconAssets`, aligned with `blockColors` and `blockIcons`.
- `scripts/sync-miniprogram-skins.cjs` copies `blockIconAssets` into generated miniprogram skin data.
- The SVG files are project-authored UI glyphs based on broad visual references listed above, not copied third-party binary artwork.

## Production Notes

If future iterations replace the project-authored SVGs with downloaded SVG/PNG assets,
keep each asset in a source-specific folder with a license file and update this
document with:

- source URL
- license URL and snapshot date
- attribution text if required
- modified/unmodified status
- production approval status
