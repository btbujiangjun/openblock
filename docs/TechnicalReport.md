# OpenBlock: A Full-Stack Adaptive Tile-Matching Platform with Reinforcement Learning and Programmatic Content Generation

> **Technical Report — v1.0**
>
> **Authors**: OpenBlock Contributors  
> **Affiliation**: Independent / Open Source  
> **Last Updated**: 2026-07-01

---

## 目录 / Table of Contents

1. [Abstract](#1-abstract)
2. [Introduction](#2-introduction)
3. [Game Overview and Problem Formulation](#3-game-overview-and-problem-formulation)
4. [System Architecture](#4-system-architecture)
5. [Real-Time Player Profiling](#5-real-time-player-profiling)
6. [The Spawn Engine: Programmatic Content Generation](#6-the-spawn-engine)
7. [Scoring, Placement Quality, and Evaluation](#7-scoring-placement-quality-and-evaluation)
8. [The RL Agent: Self-Play Placement Policy](#8-the-rl-agent-self-play-placement-policy)
9. [Neural Spawn Generation: SpawnPolicyNet](#9-neural-spawn-generation-spawnpolicynet)
10. [Spawn Parameter Tuning: SpawnParamTuner](#10-spawn-parameter-tuning-spawnparamtuner)
11. [Monetization Framework](#11-monetization-framework)
12. [Engineering and Production Infrastructure](#12-engineering-and-production-infrastructure)
13. [Evaluation and Empirical Results](#13-evaluation-and-empirical-results)
14. [Related Work](#14-related-work)
15. [Limitations and Future Work](#15-limitations-and-future-work)
16. [Appendix](#16-appendix)

---

## 1. Abstract

OpenBlock is an open-source research platform for adaptive, personalized tile-matching gameplay. Unlike commercial puzzle games that treat content generation as a black box, OpenBlock makes every spawn decision transparent, explainable, and algorithmically verifiable. The system is built around four co-evolving pillars—a tile-matching game engine, an adaptive spawn AI, a self-play reinforcement learning (RL) agent, and a non-intrusive monetization framework—all sharing a single real-time player profile table.

At the core of the execution layer lies a **dual-track spawn architecture**: a rule-based heuristic engine (`SpawnPolicyRules`) serves as the default, always-available content generator, while an optional Transformer-based neural model (`SpawnPolicyNet`) learns to predict dock triplets from real player replay data. Both tracks feed through the same nine-layer generation pipeline, culminating in a depth-first search (DFS) sequential feasibility verification that guarantees every dock can be fully placed—eliminating impossible game states by construction.

The RL agent is trained via self-play PPO with Generalized Advantage Estimation (GAE) and a suite of auxiliary supervision heads that inject dense, per-step gradient signals—including a novel per-shape placeability head that explicitly quantifies whether long-bar pieces (1×4, 1×5) remain placeable on the current board. The system is supported by a real-time player profiling engine that estimates skill via EMA smoothing, detects flow deviation, tracks frustration, and maps each player onto a 5×5 lifecycle-by-maturity differentiation grid.

All game logic, spawn decisions, RL training, and monetization signals flow through a shared event bus. The entire platform is browser-first—playable without any backend—with optional Flask microservices for RL training, neural spawn inference, and player analytics. Configuration is fully externalized in `game_rules.json`, and cross-language contract tests guarantee JavaScript ↔ Python feature parity.

---

## 2. Introduction

### 2.1 Background and Motivation

The puzzle tile-matching genre has seen remarkable growth since 2020. Block Blast, the category leader, surpassed 300 million monthly active users (MAU) with a deceptively simple core loop: a grid, a set of polyomino pieces, and a single placement action per turn. Color Block Jam (2025–) extended the formula with color-matching mechanics and pre-designed puzzle levels, shifting the genre from "player adapts to random pieces" toward "the system adapts to the player."

Despite this commercial success, the underlying technical stack of these games remains largely opaque. Content generation—which pieces to show, in what order, at what difficulty—is treated as a proprietary black box. Player state estimation, when it exists, is rudimentary. There is no standard open-source platform where researchers can experiment with adaptive difficulty algorithms, reinforcement learning agents, or explainable content generation in a realistic tile-matching environment.

OpenBlock addresses this gap. It is designed not as a commercial product but as a **research platform** where every design decision is transparent, every spawn decision carries a diagnostic snapshot, and every algorithm is configurable via externalized parameters. The platform is MIT-licensed and fully open source.

### 2.2 Design Philosophy

OpenBlock is built around four design principles that differentiate it from commercial alternatives:

**Four pillars, one player profile.** The game engine, adaptive spawn AI, RL training system, and monetization framework all read from the same player profile table. This means spawn difficulty, ad timing, and RL state encoding are grounded in a single, consistent estimate of the player's current skill, flow state, and frustration level.

**Offline-first by design.** The entire core game loop—including the spawn engine, player profiling, and difficulty decisions—runs entirely in the browser with no network dependency. Backend services (RL training, neural spawn inference, analytics) are optional enhancements, not requirements.

**Configuration-driven, not code-driven.** Every numerical parameter, threshold, and weight is externalized in `shared/game_rules.json` or environment variables. There are no magic numbers in the algorithm code. This makes the system auditable, reproducible, and safe for A/B experimentation.

**Explainable by construction.** The spawn engine records a full diagnostic snapshot at every step: which signals drove the decision, what constraints were applied, and why each candidate block was selected or rejected. The `PlayerInsightPanel` and `DecisionFlowViz` make these signals visible to both players and developers.

### 2.3 Contributions

This report presents the following contributions:

1. A **dual-track spawn architecture** combining a rule-based heuristic engine with an optional Transformer-based neural generator, unified under the same constraint validation pipeline and automatic fallback mechanism.

2. A **nine-layer content generation pipeline** (`generateDockShapes`) that progresses from board perception through constructive pre-scanning, weighted completion, constraint verification, injection optimization, and color assignment—with each layer addressing a specific sub-problem in isolation.

3. A **real-time player profiling system** that estimates skill via exponentially-weighted moving averages, detects flow deviation from optimal challenge-skill balance, tracks frustration on a multi-threshold scale, and projects each player onto a 5×5 lifecycle-by-maturity differentiation grid.

4. A **self-play RL agent** trained with PPO and GAE, augmented by seven auxiliary supervision heads that provide dense per-step gradient signals independent of sparse Monte Carlo returns—including a novel per-shape placeability prediction head.

5. A **full-stack open-source implementation** with contract-first cross-language consistency (JavaScript ↔ Python), comprehensive test infrastructure, and a configuration-driven architecture suitable for both research and production deployment.

### 2.4 Report Organization

The remainder of this report is structured as follows. §3 formalizes the game mechanics and the three sub-problems (spawn, placement, difficulty modulation). §4 presents the system architecture. §5 covers the player profiling engine. §6 describes the spawn engine in detail, including the nine-layer pipeline. §7 covers the scoring, placement quality, and evaluation framework. §8 presents the RL agent architecture and training methodology. §9 describes the neural spawn generation model (SpawnPolicyNet). §10 covers the spawn parameter tuning system (SpawnParamTuner). §11 briefly covers the monetization framework. §12 describes engineering infrastructure. §13 presents empirical evaluation results. §14 surveys related work. §15 discusses limitations and future directions.

---

## 3. Game Overview and Problem Formulation

### 3.1 Core Mechanics

OpenBlock's core gameplay is a tile-matching puzzle on an 8×8 grid. The player is presented with three candidate polyomino pieces (the "dock") and must select one piece and place it anywhere on the grid where it fits without overlapping occupied cells. When a full row or column is formed, those cells are cleared (removed), and the player earns points. The game continues until no dock piece has a legal placement position on the current board.

Key mechanical properties:
- **28 polyomino shapes** across 7 categories: lines (8), rects (2), squares (2), T-shapes (4), Z-shapes (8), L-shapes (12), J-shapes (4).
- **No rotation**: pieces have fixed orientation.
- **Fixed grid size**: 8×8 = 64 cells.
- **Three-slot dock**: exactly 3 candidate pieces visible at all times.
- **Quadratic clear scoring**: `baseUnit × c²` where c = rows cleared + columns cleared in a single placement.

### 3.2 The Three-Layer Decision Pipeline

Gameplay is organized into three conceptual layers, each with a distinct responsibility:

```
Layer 1 — Perception (Board → Signals)
  Board topology analysis → 17+ signal features → stress computation
Layer 2 — Decision (Signals → Intent)
  Stress + player state → spawnIntent → difficulty targets
Layer 3 — Execution (Intent → Spawn)
  Intent + targets → generateDockShapes() → three candidate blocks
```

This three-layer decomposition is critical because it separates concerns that would otherwise create tight coupling. The perception layer analyzes *what is on the board*. The decision layer determines *what kind of experience the player needs*. The execution layer translates that intent into *concrete content*.

### 3.3 Formal Problem Statements

The system addresses three formally distinct sub-problems:

**The Spawn Problem.** Given board state *B*, player profile *π*, and spawn context *ctx* (including recent history, difficulty targets, and intent), choose a dock triplet *(s₁, s₂, s₃)* from the 28-shape pool such that:

1. Each s<sub>k</sub> is a shape from the polyomino catalog;
2. The triplet is sequentially feasible: there exists an ordering where each block, when placed optimally, leads to a board state where the next block also has a legal placement;
3. The triplet approximates the target difficulty as measured by spawn step difficulty (SCD);
4. The triplet respects shape uniqueness (no duplicates) and mobility minimums.

**The Placement Problem.** This is the RL agent's domain. Given board state *s<sub>t</sub>* and dock *d<sub>t</sub>*, choose a placement action *a<sub>t</sub> = (block_idx, gx, gy)* to maximize expected cumulative reward *G<sub>t</sub>* over the remainder of the game. This is a finite-horizon MDP with a variable-length action set (only legal placements are valid).

**The Difficulty Modulation Problem.** Maintain each player in their optimal Flow channel—where perceived challenge matches perceived skill—by modulating the spawn step difficulty *d\** on a per-step basis. This involves (a) estimating the player's current skill, (b) estimating board pressure, and (c) selecting a difficulty target that keeps the challenge-skill ratio near 1.0, with adjustments based on lifecycle stage, session arc, and recent performance trajectory.

### 3.4 Key Metrics and Constraints

The spawn engine enforces three hard constraints before any dock is delivered to the player:

1. **Sequential feasibility** (DFS verification): A bounded DFS explores the placement tree to verify that all three dock blocks can be placed in *some* order. Budget: 200 nodes, leaf cap: 1. If no ordering works, the dock is rejected and regenerated.
2. **Mobility guard**: The total number of legal placements across all three dock blocks must meet or exceed a configurable minimum (`minMobilityTarget`). This prevents situations where the player has only one or two legal moves, which feels unfair.
3. **Shape uniqueness**: No duplicate shape IDs may appear in the same dock.

If any constraint fails, the spawn pipeline retries up to 22 times. If all retries are exhausted, a simplified fallback path (`fallback_simple`) generates a uniformly random triplet that passes the feasibility check.

---

## 4. System Architecture

### 4.1 Four-Pillar Overview

OpenBlock's architecture is organized around four co-equal pillars that share a single player profile:

| Pillar | Responsibility | Primary Source |
|--------|---------------|----------------|
| 🎮 **Game Engine** | Grid state, placement, clearing, scoring, rendering | `grid.js`, `game.js`, `clearScoring.js` |
| 🧠 **Adaptive Spawn AI** | Content generation, difficulty modulation, player state estimation | `adaptiveSpawn.js`, `blockSpawn.js`, `playerProfile.js` |
| 🤖 **RL Training** | Self-play agent training, policy/value networks, evaluation | `rl_pytorch/train.py`, `rl_pytorch/model.py` |
| 💰 **Monetization** | Ad timing, IAP offers, whale segmentation, LTV prediction | `monetization/index.js`, `personalization.js` |

Critically, the RL agent operates on a separate code path from human players. The agent uses the same game logic (`simulator.py` is a numpy-accelerated port of the browser game engine) and the same feature encoding, but its placement decisions are made by the neural policy, not by a human. This separation enables clean experimentation: improvements to the RL agent do not affect human gameplay until explicitly deployed through the evaluation pipeline.

### 4.2 Five-Layer Technical Stack

```
Layer 5: Presentation
  renderer.js, playerInsightPanel.js, rlPanel.js, monPanel.js,
  spawnModelPanel.js, hintEngine.js, replayUI.js

Layer 4: Application Orchestration
  game.js (main controller), main.js (entry point),
  monetization/index.js, bot/trainer.js

Layer 3: Domain Services
  ┌────────────┬────────────────┬──────────────────────┐
  │ Player     │ Spawn Engine   │ Monetization         │
  │ System     │                │ Framework            │
  │ profile.js │ adaptiveSpawn  │ MonetizationBus      │
  │ progress   │ blockSpawn.js  │ adAdapter/iapAdapter │
  │ .js        │ spawnModel.js  │ personalization.js   │
  └────────────┴────────────────┴──────────────────────┘

Layer 2: Core Game Logic
  grid.js, shapes.js, gameRules.js, clearScoring.js,
  api.js, database.js

Layer 1: Shared Configuration
  shared/game_rules.json, shared/shapes.json, .env
                  ↕ REST API (Flask)
  ┌─────────────────────────────────────────────────────┐
  │ Backend Services (Optional)                         │
  │ rl_backend.py, rl_pytorch/train.py, spawn_model/*  │
  │ server.py, server_authority.py, server_replay.py   │
  └─────────────────────────────────────────────────────┘
```

### 4.3 Cross-Platform Architecture

OpenBlock targets four platforms from a single codebase:

| Platform | Implementation | Feature Set |
|----------|---------------|-------------|
| **Web** | Vite + vanilla JS, Canvas/WebGL renderer | Full features |
| **WeChat Mini Program** | Adapted build with platform-specific adaptations | Excludes RL, monitoring; subset of monetization |
| **iOS/Android** | Capacitor WebView wrapper | Full features via embedded WebView |
| **Cocos Creator** | Separate rendering layer, shared game logic | In development; targets native performance |

The key architectural constraint is that all platforms share the same `shared/game_rules.json` configuration, the same shape definitions (`shared/shapes.json`), and the same feature encoding—guaranteeing that a spawn decision made on one platform is identical to the same decision on another.

### 4.4 Backend Services

Optional backend services are implemented as Flask microservices:

- **RL Backend** (`rl_backend.py`): Training orchestration, model checkpoint management, inference API.
- **Spawn Tuning Backend**: SpawnParamTuner training, sample management, policy deployment.
- **Player Analytics**: Aggregate profile computation, cohort analysis.
- **Auth Service** (`server_authority.py`): Argon2id password hashing, JWT with access/refresh token rotation.

All services expose Prometheus `/metrics` endpoints and are instrumented with OpenTelemetry for distributed tracing (W3C tracecontext propagation).

### 4.5 Data Flow and Event Bus

A unified event bus connects game events to all consuming subsystems:

```
Game Event (placement, clear, gameOver, etc.)
  → MonetizationBus.emit(event)
      → MonetizationDecisionEngine (ad timing)
      → PlayerProfile.update(event) (skill, flow, frustration)
      → SessionEval.record(event) (quality metrics)
      → SpawnContext.update(event) (history, diagnostics)
      → state_history INSERT (replay and analytics)
```

This event-driven architecture enables the monetization framework to observe game state without modifying it, and allows new consumers to be added without changing the game engine.

### 4.6 Configuration-Driven Design

`shared/game_rules.json` serves as the single source of truth for all algorithm parameters. Key sections include:

- `featureEncoding`: state/action/phi dimensions, normalization constants.
- `adaptiveSpawn`: 10-tier profile tables, constructive spawn parameters, difficulty bucket configuration.
- `rlRewardShaping`: reward weights, auxiliary supervision coefficients, outcome value mixing.
- `playerAbilityModel`: skill computation weights, EMA decay rates, flow thresholds.
- `clearScoring`: base score unit, combo multiplier, icon bonus configuration.

All algorithm code checks enforce a "no magic numbers" rule: every numerical parameter must be read from `game_rules.json` or a database table, never hardcoded. Ten Architecture Decision Records (ADRs) document key technical choices, from bitmap encoding limits to WASM compilation targets.

---

## 5. Real-Time Player Profiling

### 5.1 Design Goals

The player profiling system operates under three constraints: (1) it must run entirely in the browser with sub-millisecond overhead, (2) it must produce stable estimates from noisy, sparse observations, and (3) it must be interpretable—both to developers debugging spawn decisions and to players viewing their own ability metrics.

### 5.2 Skill Estimation

Instantaneous raw skill is computed as a weighted combination of five behavioral signals:

$$
r_t^{\text{skill}} = 0.15 \cdot \text{thinkScore} + 0.30 \cdot \text{clearScore} + 0.20 \cdot \text{comboScore} + 0.20 \cdot \text{missScore} + 0.15 \cdot \text{loadScore}
$$

where `thinkScore` captures decision speed, `clearScore` reflects clearing efficiency, `comboScore` tracks combo chain maintenance, `missScore` penalizes wasted placements, and `loadScore` accounts for cognitive load indicators.

This raw score is smoothed via exponential moving average (EMA):

$$
s_t = s_{t-1} + \alpha(r_t - s_{t-1})
$$

with an adaptive decay rate: α = 0.35 for the first 5 steps (rapid adaptation to new players) and α = 0.15 thereafter (stable tracking for experienced players).

To capture longer-term skill trends while remaining responsive to recent performance, a historical fusion layer blends the current EMA with an exponentially-weighted historical average:

$$
\text{histSkill} = \frac{\sum_{i=1}^{n-1} 0.85^{n-1-i} \cdot \text{skill}_i}{\sum_{i=1}^{n-1} 0.85^{n-1-i}}
$$

$$
\text{skillLevel} = (1 - w_{\text{hist}}) \cdot s_t + w_{\text{hist}} \cdot \text{histSkill}
$$

where $w_{\text{hist}} = (1 - w_{\text{smooth}}) \cdot \text{confidence}$, giving more weight to historical data when the current session has low confidence (e.g., very few steps observed).

### 5.3 Flow Detection

Flow state—the optimal experience zone where challenge matches skill—is modeled after Csikszentmihalyi's flow theory. The flow deviation is:

$$
F(t) = \left|\frac{\text{boardPressure}}{\max(0.05, \text{skill})} - 1\right|
$$

where board pressure combines three factors:

$$
\text{boardPressure} = 0.45 \cdot \text{avgFill} + 0.35 \cdot \text{clearDeficit} + 0.2 \cdot \text{cogLoad}
$$

The flow state is classified into a three-way taxonomy via a rule tree:

- **Bored** ($F(t) < 0.9$): challenge is below skill; player needs more stimulation.
- **Flow** ($0.9 \leq F(t) \leq 1.3$): challenge-skill balance is optimal.
- **Anxious** ($F(t) > 1.3$): challenge exceeds skill; player needs relief or intervention.

### 5.4 Frustration and Distress Tracking

Frustration is tracked via a simple but effective metric: consecutive steps without achieving a line clear.

$$
\text{frustrationLevel} = \text{consecutive\_no\_clear\_steps}
$$

Thresholds trigger escalating interventions: at 3 steps (warning), the spawn engine may inject an easier block; at 4 steps (IAP hint), the monetization system may offer a rescue item; at 5 steps (rescue), intervention is mandatory.

The `distress` signal captures cumulative structural damage: holes (unfillable empty cells), transitions (row/column 0↔1 boundaries), and well depth all contribute to a composite distress metric that, when elevated, triggers spawn difficulty reduction even before frustration reaches threshold levels.

### 5.5 Momentum and Streak

Momentum captures the direction and rate of performance change:

$$
\Delta = \text{clearRate}(\text{recent\_window}) - \text{clearRate}(\text{baseline\_window})
$$

$$
\text{momentum} = \text{clamp}(\Delta / 0.3, -1, 1)
$$

Positive momentum (>0) indicates improving performance and can justify slightly increasing difficulty. Negative momentum (<0) triggers caution: the spawn engine may hold difficulty steady or reduce it, even if the player's absolute skill estimate hasn't changed.

### 5.6 Lifecycle × Maturity Matrix (25-Grid)

OpenBlock models each player along two orthogonal axes, creating a 5×5 differentiation grid:

|  | S0 (New) | S1 (Active) | S2 (Plateau) | S3 (Churn) | S4 (Return) |
|--|----------|-------------|--------------|------------|-------------|
| **M4 (Expert)** | — | Full challenge | Maintain engagement | Re-engagement reward | Welcome-back bonus |
| **M3 (Skilled)** | — | Graduated challenge | Plateau breaker | Churn prevention | Gentle re-onboarding |
| **M2 (Intermediate)** | Accelerated ramp | Standard progression | Fresh content push | Retention offer | Tutorial refresher |
| **M1 (Novice)** | Extended tutorial | Protected difficulty | Overwhelm guard | Comeback incentive | Full re-tutorial |
| **M0 (Beginner)** | Maximum protection | Guided progression | Frustration shield | Rescue package | Complete restart |

**Lifecycle stages** (S0–S4) are derived from `daysSinceInstall`, `totalSessions`, and `daysSinceLastActive` via a three-way AND gate. **Maturity bands** (M0–M4) are derived from skill score percentile thresholds (≥90, ≥80, ≥60, ≥40, <40).

### 5.7 Offline Aggregate Profile (Player Analytics)

Complementing the real-time profile, an offline aggregate analytics pipeline (`playerAnalytics`) consumes frame-level time series data to produce:

- **Six-dimensional ability vector** with confidence bounds: topology management, scoring efficiency, execution speed, reaction adaptability, survival resilience, and performance consistency.
- **Temporal traits**: trend (improving/declining), endurance (sustained performance), clutch (high-pressure performance boost).
- **Spawn advice layer**: per-shape competence scores, comfort fill band range, topology weakness identification, and personalized relief/delight thresholds.

This offline profile serves as a cold-start prior for returning players and as a ground-truth reference for A/B test evaluation.

---

## 6. The Spawn Engine: Programmatic Content Generation

### 6.1 Design Space and Constraints

The spawn engine must select 3 polyomino pieces from a 28-shape catalog given an 8×8 board with up to 64 occupied cells. The combinatorial space is vast: 28³ = 21,952 possible triplets before considering positional constraints. The engine must balance four competing objectives:

1. **Solvability**: every dock must be fully placeable (hard constraint via DFS verification).
2. **Engagement**: pieces should create clear opportunities to sustain motivation.
3. **Challenge calibration**: difficulty should match the player's current skill state.
4. **Delight**: occasional "lucky breaks" (perfect clears, icon bonuses) should feel earned.

### 6.2 Dual-Track Architecture

```
                    ┌─────────────────────┐
    Board + Context │  buildSpawnModel-   │
    + Player Profile│     Context()       │
                    └─────────┬───────────┘
                              │
              ┌───────────────┴───────────────┐
              ↓                               ↓
    ┌─────────────────────┐       ┌─────────────────────┐
    │ Track 1: Rule (默认) │       │ Track 2: Neural (可选) │
    │ SpawnPolicyRules     │       │ SpawnPolicyNet       │
    │ blockSpawn.js        │       │ spawnModel.js        │
    │ 9-layer pipeline     │       │ Transformer AR       │
    │ 14-dim weight chain  │       │ ~317K params         │
    └─────────┬───────────┘       └─────────┬───────────┘
              │                             │
              └──────────┬──────────────────┘
                         ↓
              ┌─────────────────────┐
              │  Constraint         │
              │  Validation Gate    │
              │  · Sequential feas  │
              │  · Mobility guard   │
              │  · Shape uniqueness │
              └─────────┬───────────┘
                        │
              ┌─────────┴───────────┐
              ↓                     ↓
         Pass → Deliver        Fail → Retry (×22)
              to Dock                 or Fallback
```

**Track 1** (`SpawnPolicyRules`) is the default, always-available path. It runs entirely in the browser with sub-5ms latency and is fully explainable—every weight, every decision, every constraint check is logged. **Track 2** (`SpawnPolicyNet`) is an optional neural alternative that learns to predict `P(s₁, s₂, s₃ | board, context, history)` from real player replay data. Its output passes through the same constraint validation gate as Track 1; if validation fails, the system automatically falls back to Track 1.

Both tracks consume the same context object (`buildSpawnModelContext()`), which includes difficulty mode, ability vector, player profile real-time state, board topology, in-game rhythm, between-game arc, recent spawn history, and rule-track spawn hints.

### 6.3 The Nine-Layer Generation Pipeline

The rule-track engine (`generateDockShapes` in `blockSpawn.js`) is organized as a sequential nine-layer pipeline. Each layer addresses a specific, well-defined sub-problem:

**Layer 1: Input Assembly.** Aggregates board state, player profile, spawn context (recent history, difficulty targets), and the current spawn intent into a unified context object.

**Layer 2: Board Perception.** Extracts geometric and topological features using `analyzeBoardTopology`: fill ratio, row/column statistics, hole count (unfillable empty cells), row/column transitions (0↔1 boundaries), well depth, contiguous empty regions, and concave corners. Also computes spatial planning features (region entropy, largest region ratio, small region ratio).

**Layer 3: Score Construction.** Fuses 17 signals into composite scores: density pressure (SCD = total block cells ÷ free cells), board difficulty, placement flexibility (count of legal positions), solution count (bounded DFS), killer-shape pressure (large or long-bar pieces with few placements), and spatial fragmentation (region entropy + small region ratio). The weighted composite produces a `spawnStepDifficulty` in [0,1], classified into 5 buckets: trivial / easy / standard / hard / extreme.

**Layer 4: Priority Selection.** The 10-intent priority scheduler selects a `shapeWeights` bias profile and a `clearGuarantee` quota based on the current spawn intent:

| Priority | Intent | clearGuarantee | Shape Bias |
|----------|--------|----------------|------------|
| 115 | `warm_run` | 2 | Easy blocks, flush clears |
| 102 | `pb_chase` | 1 | Slightly harder, PB-relevant |
| 100 | `relief` | 2 | Stress relief, easy blocks |
| 95 | `delight_starved` | 1 | Multi-clear, icon bonuses |
| 90 | `engage` | 1 | Balanced with variety |
| 80 | `harvest` | 0 | Efficiency-optimized |
| 70 | `pressure` | 0 | Graduated challenge |
| 60 | `sprint` | 0 | Speed-oriented shapes |
| 50 | `flow` | 0 | Standard distribution |
| 0 | `maintain` | 0 | Pure random weighted |

**Layer 5: Weighted Completion.** A 14-dimensional weight chain drives two-stage constructive filling:

- **Shape base weights (12 dimensions)**: `gapFills`, `multiClear`, `holeReduce`, `mobility`, `salvage`, `pcPotential`, `clearGuarantee`, `comboFwd`, `diversity`, `novelty`, `stressBalance`, `monoTarget`. Each weight amplifies or attenuates the selection probability of shapes that serve that objective.
- **Enhancement layer (2 dimensions)**: `delightBoost` (amplified when the player is "delight-starved"—hasn't experienced a satisfying multi-clear recently) and `stressOverride` (caps difficulty when the player's stress is elevated).

The two stages of construction are:
1. **Stage 1 (clearSeats)**: If `clearGuarantee > 0`, the engine pre-allocates 1–2 dock slots for shapes that can immediately clear at least one line.
2. **Stage 2 (weightedFill)**: Remaining slots are filled by weighted sampling from the augmented shape pool.

**Layer 6: Constraint Verification.** Three sequential gates:
1. **Shape uniqueness**: no duplicate shape IDs.
2. **Mobility check**: total legal positions ≥ `minMobilityTarget`.
3. **DFS sequential feasibility**: a bounded depth-first search explores all placement orderings to confirm the full dock is placeable. Budget: 200 nodes; leaf cap: 1 (binary pass/fail).

**Layer 7: Injection Optimization.** Special event blocks (e.g., flush-clear pieces, icon-matched chains) are inserted when conditions align, overwriting regular weighted selections. These injections are gated to prevent excessive frequency: a `constructiveRetry` counter ensures failed injections don't cascade, and a `retryBoost` (+0.25 probability on next attempt) provides a grace window.

**Layer 8: Output Delivery.** The final triplet is confirmed, and diagnostic metadata—including the spawn intent, difficulty metrics, constructive pre-scan results, and constraint check outcomes—is attached to the spawn context for downstream consumers (panels, analytics, replay).

**Layer 9: Color Display.** Color weights are assigned using `monoNearFullLineColorWeights`, which scans rows and columns that are 1–2 cells from completion and amplifies the sampling weight of colors that match the existing cells in those near-complete lines. This creates "icon bonus" opportunities without compromising the shape selection.

### 6.4 Constructive Pre-Scan (C1/C2/C3)

Before weighted completion (Layer 5), the engine runs a constructive pre-scan that examines the current board for structural opportunities:

- **C1 (Completer)**: Identifies rows or columns that are one cell away from being full. If such near-complete lines exist, the engine biases shape selection toward pieces that can fill the missing cell(s).
- **C2 (Setup)**: Identifies configurations where placing a specific shape creates a *future* near-complete line—even if the placement itself doesn't clear anything. This is the engine "thinking ahead" one step.
- **C3 (Order Anchor)**: When multiple constructive opportunities exist, C3 determines the optimal ordering for the three dock slots to maximize the probability of at least one clear event.

Between stages, a **PEOG clamp** (Placement Efficiency and Operator Guard) restricts the constructive operator candidate set to prevent the engine from over-committing to complex constructions that might fail under time pressure.

### 6.5 Between-Game Difficulty (RoR)

Between individual games, difficulty progression is modulated by the **Rate of Return (RoR)** system. The player's current session arc (5 levels: opener, momentum, peak, fatigue, cooldown) determines the baseline difficulty trajectory. A humped curve models the expected rise and fall of performance within a session:

$$
d^*(n) = d_{\text{base}} \cdot \left(1 + h \cdot \frac{n}{N} \cdot \left(1 - \frac{n}{N}\right)\right)
$$

where *n* is the current game number in the session, *N* is the expected session length, and *h* is the hump height (configurable per arc stage).

A 5×5×5 cubic modulation matrix (arc × session offset × PB ratio) enables fine-grained difficulty targeting. For example, a player in the "momentum" arc, at their 5th game, 30% below their PB, receives a different difficulty profile than the same player in "fatigue" at their 20th game, at 90% of PB.

### 6.6 Spawn Step Difficulty (SCD) Metrics

At each spawn decision, a lightweight, deterministic SCD computation runs:

```
scdNorm         = total_block_cells / (free_cells + ε) / scdSaturation
comboCellsNorm  = total_block_cells / comboCellsNorm(15)
comboKillerNorm = count(shapes that are large or long-bar) / dockSlots(3)
comboLongBarNorm = count(shapes that are 1×4 or longer) / dockSlots(3)
```

These four features are all computable in O(shapes) time without any board scanning beyond the existing `fast_board_features`, making them suitable for MCTS hot-path invocation. They are concatenated into the RL state vector and serve as auxiliary supervision targets.

For the RL training auxiliary head (v13), an additional 8 dimensions of **per-shape placeability** are appended: for eight fixed representative shapes (1×4, 4×1, 1×5, 5×1, 2×2, 3×3, T-up, L3-a), the normalized legal position count `len(get_legal_positions(board, shape)) / theoretical_max` is computed. These 8 dimensions directly quantify the "long-bar bottleneck"—the empirically verified observation that 1×4 and 1×5 pieces lose 33–56% of their legal positions at ≥70% board fill rate, making them the primary cause of late-game death.

### 6.7 Guard Rails and Fallback

The spawn engine includes multiple layers of protection:

1. **22 retry attempts**: Each retry re-executes the full two-stage construction with different random seeds. If all attempts fail the constraint verification gate, the system falls back to `fallback_simple`.
2. **`fallback_simple`**: A simplified path that uniformly randomly samples shapes until a feasible triplet is found. This guarantees a playable dock even in worst-case board states.
3. **Warm Run clamping**: For new (S0), returning (S4), and struggling (high distress) players, a post-hoc override (`applyWarmRun`) adjusts shape weights to prioritize easy-to-place, high-clear-potential pieces. The warm budget gradually decays over the session to prevent dependency.
4. **Overload protection**: When board fill rate exceeds 70%, the difficulty target is automatically reduced by up to 0.2 to prevent the "unplaceable long-bar" death spiral.

---

## 7. Scoring, Placement Quality, and Evaluation

### 7.1 Clear Scoring Formula

The scoring system uses a quadratic formula that strongly rewards multiple simultaneous clears:

$$
\text{score} = \text{baseUnit} \cdot c^2
$$

where $c$ = rows cleared + columns cleared in the placement. The base unit defaults to 20 points. This quadratic scaling means a single-line clear earns 20 points, while a 3-line clear earns 180 points (9× rather than 3× the single-line value).

**Icon Bonus.** If any cleared row or column consists entirely of blocks sharing the same icon or color, those lines earn a multiplier: $\text{lineScore} = \text{baseUnit} \cdot c \cdot \text{iconBonusLineMult} \cdot b$, where $b$ is the number of icon-matched lines. This rewards strategic placement toward icon homogeneity.

**Perfect Clear.** If the board becomes completely empty after clearing (all 64 cells are vacant), the score is multiplied by $\text{perfectClearMult} = 10$, creating a high-risk, high-reward target for skilled players.

**Combo Multiplier.** Consecutive placements that clear lines increment a combo counter. The combo continues as long as the gap between clear events is less than the grace window (default: 3 placements). The multiplier is:

$$
m_{\text{combo}} = \min(m_{\text{max}}, 1 + \max(0, \text{comboCount} - \text{activationCount} + 1) \cdot \text{stepBonus})
$$

with default parameters: activationCount = 3, stepBonus = 0.0, maxMultiplier = 1.0. This allows future configuration to reward sustained combo chains.

The full score for a placement is:

$$
\text{score}_{\text{placement}} = (c^2 \cdot \text{baseUnit} + \text{iconBonus}) \cdot \text{perfectMult} \cdot m_{\text{combo}}
$$

### 7.2 Placement Quality (Step-Level)

Each placement is evaluated on a 5-dimensional quality vector, computed immediately after the placement-and-clear cycle:

| Dimension | Description |
|-----------|-------------|
| **Topology delta** | Change in board structural quality (holes, transitions, wells, close-to-full lines) |
| **Mobility delta** | Change in total legal placement count across all shapes |
| **Clear potential** | Whether the placement created or destroyed near-complete lines |
| **Near-full-line proximity** | Distance to the next possible clear event |
| **Salvage quality** | When placement options are extremely limited (≤4 legal moves), whether the placement created a clear despite the difficulty |

The overall placement quality is a weighted composite. Regret is computed as the gap between the chosen placement's quality and the best possible placement's quality for that board-dock configuration:

$$
\text{regret} = \text{quality}_{\text{best}} - \text{quality}_{\text{chosen}}
$$

Regret is normalized by a configurable denominator (default: 8.0) and clamped to [0, 1].

### 7.3 Round Quality (Dock-Level)

After all three dock blocks are placed (or the game ends), the round receives a quality classification with three regret components:

1. **Order regret**: Was the placement order optimal? (Could reordering the three placements have produced a strictly better board?)
2. **Path regret**: Was each individual placement optimal given the chosen order?
3. **Payoff regret**: Did the round achieve the expected clear reward given the board state and dock composition?

Special tags (`forced_bad` and `salvage`) identify edge cases: `forced_bad` marks rounds where hole count increased by ≥2 despite optimal play (indicating the dock was structurally difficult), and `salvage` marks rounds where a clear was achieved despite mobility ≤4 (indicating skillful play under constraint).

### 7.4 Session Evaluation

At the session level, a `sessionEvalRecord` aggregates per-round quality metrics into a structured JSON object stored in the `evaluation_session` table. Key fields include:

- Average placement quality and its variance
- Forced-bad round ratio (fairness indicator)
- Salvage round ratio (skill indicator)
- Round-to-round quality trend (is the system improving or degrading the experience?)
- Correlation between spawn difficulty and placement quality (does harder spawning produce worse play?)

The evaluation data feeds back into `adaptiveSpawn` through `evalMetrics`, a sliding window of recent quality scores. When `consecutiveForcedBad ≥ 2`, the engine increases `clearGuarantee` by 2 (aggressive relief). When rounds are classified as `forced_bad`, the `targetSolutionRange.max` is increased by 2 (widening the acceptable solution space).

### 7.5 The Feedback Closed Loop

A real-time feedback bias signal closes the loop between player action and spawn difficulty:

```
player clears more lines than expected → feedbackBias +α
player clears fewer lines than expected → feedbackBias −α
```

The bias is clamped to ±0.15 and smoothed with α = 0.02. It feeds directly into the stress computation: `stress += feedbackBias`. This creates a sub-second response loop: if the player is struggling, difficulty drops immediately without waiting for the slower skill EMA to adjust.

A damping mechanism prevents the bias from becoming counterproductive: when `feedbackBias > 0` (positive, suggesting the player can handle more) but `distress > 0` (the player is showing structural damage), the bias is reduced by `min(0.08, bias × 0.5 × distress)`. This prevents the system from increasing difficulty on a player who is clearing lines but destroying their board structure in the process.

---

## 8. The RL Agent: Self-Play Placement Policy

### 8.1 Problem Formulation

The placement problem is formulated as a finite-horizon Markov Decision Process (MDP):

- **State** $s_t \in \mathbb{R}^{204}$: 65-dimensional scalar feature vector (25 structural primitives + 19 color summary + 4 spawn step difficulty + 3 spatial planning + 3 strategy one-hot + 11 condition tokens), 64-dimensional flattened grid occupancy (8×8), 75-dimensional dock spatial encoding (3 slots × 5×5 mask).
- **Action** $a_t$: a legal placement `(block_idx, gx, gy)`, with a variable-length action set per step. The action feature $\psi(a) \in \mathbb{R}^{15}$ encodes near-full-line ratio, 8-neighbor occupancy context, and 6 self-features of the target shape.
- **Reward** $r_t = \Delta\text{Score} + 0.8 \cdot \Delta\Phi_{\text{topology}} + 0.6 \cdot r_{\text{eval}} + \text{winBonus}(35)$, where $\Phi$ is a potential function over board structure and $r_{\text{eval}}$ is an instantaneous evaluation feedback term (not a potential difference, so it doesn't create phantom energy). A stuck penalty of −8 is applied at the final step if the game ends without reaching the win threshold.
- **Termination**: the episode ends when no dock block has a legal placement (game over) or when the score reaches the win threshold.

### 8.2 State and Action Feature Encoding

The 204-dimensional state vector is carefully designed to expose structural information that a convolutional network would struggle to extract from raw grid input alone:

**Scalar segment (65 dimensions):**

| Sub-vector | Dimensions | Content |
|------------|-----------|---------|
| Structural primitives | 25 | fill_ratio, row/col max/min/mean/std, almost_full ratios, holes, row/col transitions, wells, close-to-full counts, mobility, height standard deviation, contiguous empty regions, concave corners |
| Color summary | 19 | 8 color ratios on board + 8 single-color-line potentials + 3 dock slot colors |
| Spawn step difficulty | 4 | scdNorm, comboCellsNorm, comboKillerNorm, comboLongBarNorm |
| Spatial planning | 3 | regionEntropy, largestRegionRatio, smallRegionCellRatio |
| Strategy one-hot | 3 | easy / normal / hard |
| Condition tokens | 11 | arc (5: opener, momentum, peak, fatigue, cooldown) + intent (6: relief, engage, pressure, flow, harvest, maintain) |

**Grid segment (64 dimensions):** Flattened 8×8 occupancy map, with occupied cells encoded by their color ID and empty cells as −1.

**Dock segment (75 dimensions):** Three 5×5 binary masks, each encoding the spatial footprint of one dock block, centered within the 5×5 canvas.

### 8.3 Network Architecture: ConvSharedPolicyValueNet

The ConvSharedPolicyValueNet (v5, ~188K parameters with width=128, conv_channels=32) uses a shared trunk that separately encodes the scalar, grid, and dock segments before fusing them:

**Grid Encoder:**
```
grid(8×8, 1 channel)
  → Conv2d(1→32, 3×3, pad=1) → GELU
  → ResConvBlock(32) → GELU      # residual: Conv→GELU→Conv + skip
  → ResConvBlock(32) → GELU
  → feature maps: [B, 32, 8, 8]
  → Global AvgPool: [B, 32]
```

**Dock Encoder (DockBoardAttention):**
```
dock_masks: [B, 3, 25]  (3 blocks × 5×5 flattened)
grid_feat:  [B, 32, 8, 8]  (from Grid Encoder, before pooling)

Q = Linear(25→16)(dock_masks)      → [B, 3, 16]
K = Conv2d(32→16, 1×1)(grid_feat)  → [B, 16, 64]
V = Conv2d(32→16, 1×1)(grid_feat)  → [B, 16, 64]

Attention: softmax(Q·K / √16) · Vᵀ → [B, 3, 16]
Output: Linear(16→16) → flatten → [B, 48]
```

This cross-attention mechanism lets each dock block "query" the board's spatial features: the L-shaped block can attend to corners, the line block to rows, and so on. This replaces the earlier approach of blindly flattening the 75-dimensional dock mask into the MLP input.

**Shared Trunk:**
```
x = concat[scalars, grid_pooled, dock_ctx]  → [B, 65+32+48 = 145]
  → LayerNorm → Linear(145→128) → GELU    # trunk_fc1
  → + GELU(Linear(128→128))               # trunk_fc2 (residual)
  → + GELU(Linear(128→128))               # trunk_fc3 (residual)
  → h(s): [B, 128]
```

**Heads:**
- `policy_head`: h(s) ‖ GELU(action_proj(ψ(a))) → Linear(176→64) → GELU → Linear(64→1) → logits, masked to legal actions, softmax.
- `value_head`: h(s) → Linear(128→value_dim) → GELU → Linear(value_dim→1) → V(s).
- **Auxiliary supervision heads** (see §8.5).

### 8.4 Training Algorithm

**PPO (n_epochs > 1):** For each collected batch, the policy is updated for `ppo_epochs` iterations with clipping:

$$
\text{ratio}_t = \frac{\pi_{\text{new}}(a_t|s_t)}{\pi_{\text{old}}(a_t|s_t)}, \quad
\mathcal{L}_{\text{policy}} = -\mathbb{E}\left[\min(\text{ratio} \cdot A_t,\; \text{clip}(\text{ratio}, 1-\varepsilon, 1+\varepsilon) \cdot A_t)\right]
$$

with $\varepsilon = 0.25$ and $ppo\_epochs = 4$.

**RENFORCE-baseline (n_epochs = 1):** Falls back to vanilla policy gradient: $\mathcal{L}_{\text{policy}} = -\mathbb{E}[\log\pi(a|s) \cdot A_t]$.

**Value loss:** Double-clipped SmoothL1 (Huber):

$$
v_{\text{clipped}} = v_{\text{old}} + \text{clamp}(v_{\text{new}} - v_{\text{old}}, -\varepsilon, +\varepsilon)
$$

$$
\mathcal{L}_{\text{value}} = \mathbb{E}\left[\max(\text{SmoothL1}(v_{\text{new}}, R_t),\; \text{SmoothL1}(v_{\text{clipped}}, R_t))\right]
$$

**Mixed value target:** Combines sparse outcome signal with dense GAE returns:

$$
R_t = (1 - \text{mix}) \cdot \text{GAE}_t + \text{mix} \cdot \text{clip}\left(\frac{\log(1 + \text{final\_score})}{\log(1 + \text{threshold})}, 0, 3\right)
$$

with mix = 0.5. This hybrid target provides low-variance value estimates while preserving the credit assignment benefits of GAE.

**Advantage:** GAE with $\lambda = 0.85$, $\gamma = 0.99$, normalized to zero mean and unit variance (with a minimum standard deviation guard of 1e-4 to prevent division by near-zero variance).

### 8.5 Auxiliary Supervision Heads

A key innovation in the v5 architecture is the use of auxiliary supervision heads that provide dense, per-step gradient signals independent of sparse Monte Carlo returns:

| Head | Dimensions | Loss | Target | Coefficient | Correlation with Score |
|------|-----------|------|--------|-------------|----------------------|
| `board_quality` | 1 | SmoothL1 | Φ(s) / 30 | 0.5 | r = +0.011 (p = 0.86) |
| `feasibility` | 1 | BCE | DFS sequential solvability | 0.3 | r = −0.172 (p < 0.0001) |
| `survival` | 1 | SmoothL1 | steps_to_end / 30 | 0.2 | r = −0.202 (p < 0.0001) |
| `topology_aux` | 10 | SmoothL1 | Post-placement topology vector | 0.0 | — |
| `spawn_diff_aux` | 12 | SmoothL1 | 4-dim SCD + 8-dim per-shape placeability | 0.05 | — |
| `hole_aux` | 1 | SmoothL1 | Unfillable cells after placement | 0.0 | — |
| `clear_pred` | 1 | CrossEntropy(4-class) | Clear category (0/1/2/≥3) | 0.15 | — |

The `spawn_diff_aux` head (v13) is particularly notable. The original 4-dimensional SCD prediction showed near-zero correlation with game outcomes (r = −0.009, p = 0.69). The v13 extension to 12 dimensions—adding 8 per-shape placeability features—directly exposes the long-bar bottleneck to the trunk. Each of the 8 additional dimensions quantifies, for a fixed representative shape, the normalized count of legal placements on the current board. This tells the network not just "this dock is hard" but specifically "the 1×5 piece has zero legal positions on this board" versus "it has 8 legal positions."

**Total loss:**

$$
\mathcal{L} = \mathcal{L}_{\text{policy}} + w_v \cdot \mathcal{L}_{\text{value}} - w_e \cdot H(\pi) + \sum_{k} w_k \cdot \mathcal{L}_{\text{aux},k} + \text{distillation terms}
$$

where auxiliary losses are hard-clamped to ±20 to prevent numerical explosions from extreme board states. Policy and value losses are not clamped. Q-distillation and visit-distribution distillation are optional (only active when MCTS or beam search is enabled).

### 8.6 Exploration and Curriculum

**Exploration.** The action distribution is a mixture of temperature-softened policy logits and Dirichlet noise:

$$
\pi_{\text{sample}} = (1 - \varepsilon) \cdot \text{softmax}(\text{logits} / T) + \varepsilon \cdot \text{Dir}(\alpha)
$$

with $\varepsilon = 0.08$, $\alpha = 0.28$, and $T$ annealing from 1.2 (early exploration) to 0.6 (late exploitation). An adaptive entropy target band ($0.2$ width) uses feedback control: if measured entropy exceeds the target, $w_e$ decreases to reduce exploration pressure; if entropy falls below, $w_e$ increases.

**Victory threshold curriculum.** The win score threshold adapts to training progress via three modes:
- **Quantile**: tracks the EMA of recent top-K scores, setting the threshold at a configurable quantile.
- **Adaptive**: increases the threshold when the recent win rate exceeds a target.
- **Linear**: simple episode-count-based ramp.

**Difficulty bucket curriculum.** Training episodes are assigned a maximum spawn step difficulty (SCD) ceiling that progressively increases from 0.3 (only trivial/easy docks) to 1.0 (full difficulty range) as training progresses through configurable stages. This prevents early training from being dominated by impossible board states.

### 8.7 Search Enhancement (Optional)

The RL agent can optionally leverage online search during both training and inference:

- **MCTS** (`RL_MCTS=1`): Classical UCT-based tree search with a shared Zobrist transposition table for state deduplication. Configurable simulation counts (min/max) with adaptive early termination based on visit count confidence.
- **Beam search** (`RL_BEAM2PLY` / `RL_BEAM3PLY`): Lightweight 2- or 3-ply lookahead that evaluates all legal placement sequences and selects the one maximizing a value-plus-reward objective.
- **Q-value distillation**: When search is active, the softmax over normalized Q-values (with temperature τ) serves as a teacher distribution for the policy head, via cross-entropy distillation loss.
- **Visit distribution distillation**: When MCTS is active, the normalized visit count distribution over root actions serves as an additional AlphaZero-style teacher.

### 8.8 Training Infrastructure

Training uses a multi-process worker pool architecture:

1. **Main process**: GPU gradient computation and parameter updates.
2. **Worker processes** (configurable count): CPU inference with `torch.inference_mode()` for trajectory collection. Each worker maintains its own copy of the model, reloading weights when the version changes.
3. **Shared state**: Weights are broadcast via temporary file serialization to minimize IPC overhead.
4. **Checkpoint system**: Periodic saves with BestGuard rollback protection. If evaluation metrics degrade beyond configurable thresholds, the system automatically reverts to the best-known checkpoint.
5. **Quality gate**: Automated regression detection checks teacher coverage (must not drop >2%), win-rate moving average (must not drop >3%), and spawn difficulty drift (must not exceed 5%).

---

## 9. Neural Spawn Generation: SpawnPolicyNet

### 9.1 Motivation

The rule-based spawn engine, while robust, has an inherent limitation: it can only express designer-specified heuristics. The 14-dimensional weight chain captures known important factors (mobility, clear potential, diversity), but it cannot discover *unknown* patterns in how real players prefer certain shape combinations in certain board contexts. Moreover, maintaining the weight chain requires expert tuning as the game evolves.

SpawnPolicyNet addresses this by learning the conditional distribution $P(s_1, s_2, s_3 \mid B, \pi, H)$ directly from data—real player replays, rule-engine games, and self-play rollouts. It serves as an optional alternative to the rule track, not a replacement: its output is validated by the same constraint pipeline, and any validation failure triggers automatic fallback to the rule engine.

### 9.2 Model Architecture (V3.1)

SpawnPolicyNet V3.1 (~317K parameters) uses a Transformer encoder with autoregressive slot decoding:

**Input Encoding:**
```
board(64) ⊕ behaviorContext(24) → Linear(88→128) → GELU → LayerNorm → state_token [B, 1, 128]
target_difficulty(1) → Linear(1→128) → GELU → LayerNorm → diff_token [B, 1, 128]
history(9) → shape_embed(29×128)[history_ids] + position_embed(9×128) → hist_tokens [B, 9, 128]
learnable: cls_token [B, 1, 128], optional style_token [B, 1, 128]
```

**Sequence Assembly:**
```
tokens = [CLS, state, diff, hist₀, …, hist₈]  →  [B, 12, 128]
```

**Transformer Encoder:** 6 layers, d_model=128, 4 heads, FFN dim=256, GELU activation, dropout=0.1, norm_first=True.

**Slot Heads (Autoregressive):**
```
CLS_out = encoded[:, 0, :]                                    # [B, 128]
l₀ = head₀(CLS_out)                                            # [B, 28] — slot 1
l₁ = head₁(concat[CLS_out, emb(s₁)])                          # [B, 28] — slot 2, masked by s₁
l₂ = head₂(concat[CLS_out, emb(s₁), emb(s₂)])                 # [B, 28] — slot 3, masked by s₁,s₂
```

**Auxiliary Heads (from CLS token):**

| Head | Output | Purpose |
|------|--------|---------|
| `diversity_head` | 128→3×7 | Predict category distribution of the triplet |
| `difficulty_head` | 128→1 | Predict actual SCD to align with target |
| `feasibility_head` | 128→28 | Per-shape BCE: which shapes are legally placeable? |
| `style_head` | 128→N_style | Self-supervised: predict player style from context alone |
| `intent_head` | 128→N_intent | Self-supervised: predict spawn intent from context alone |

### 9.3 Training

**Data sources.** Training samples come from three pipelines: (1) real player game replays—each frame contains the board, the actual dock that was shown, and all context features at that moment; (2) rule-engine synthetic games—generated by running `SpawnPolicyRules` over diverse simulated player profiles, providing positive examples of rule-track behavior; (3) self-play rollouts—RL bot games where the bot places optimally, providing labeled examples of what constitutes a good board-dock configuration.

**Offline distillation.** Before training on real data, the model is pre-trained via offline distillation: the rule engine acts as a teacher, and SpawnPolicyNet as a student. This ensures the neural model can at least reproduce rule-track quality before attempting to improve upon it.

**V3.1 Composite Loss:**

$$
\mathcal{L} = w_{\text{ce}}\mathcal{L}_{\text{ce-AR}} + w_{\text{div}}\mathcal{L}_{\text{div}} + w_{\text{anti}}\mathcal{L}_{\text{anti}} + w_{\text{diff}}\mathcal{L}_{\text{diff}} + w_{\text{feas}}\mathcal{L}_{\text{feas}} + w_{\text{si}}\mathcal{L}_{\text{soft-infeas}} + w_{\text{st}}\mathcal{L}_{\text{style}} + w_{\text{intent}}\mathcal{L}_{\text{intent}}
$$

with default weights $(1.0, 0.3, 0.5, 0.1, 0.4, 0.2, 0.15, 0.10)$.

Key loss components:
- **$\mathcal{L}_{\text{ce-AR}}$**: Autoregressive cross-entropy—the main training signal. Each slot head is trained with teacher forcing: the ground-truth shape ID for slot k is used as the target.
- **$\mathcal{L}_{\text{anti}}$**: Penalizes repeated shapes or same-family shapes across all three slots.
- **$\mathcal{L}_{\text{feas}}$**: Binary cross-entropy against per-shape feasibility labels—teaches the model which shapes are even placeable on the current board.
- **$\mathcal{L}_{\text{soft-infeas}}$**: A soft penalty on logits for infeasible shapes. Instead of hard-masking (which would prevent the model from ever assigning probability to correct-but-rare shapes), this applies a gentle pressure that can be overridden by strong positive evidence.
- **$\mathcal{L}_{\text{style}}$ / $\mathcal{L}_{\text{intent}}$**: Self-supervised objectives that force the shared encoder to learn representations sensitive to playstyle and intent—even when those labels are not provided at inference time, the encoder's internal representation becomes more structured.

### 9.4 LoRA Personalization

To enable per-player personalization without maintaining 317K × N copies of the full model, Low-Rank Adaptation (LoRA) is injected at the self-attention query and value projections and the feed-forward layers:

$$
W_{\text{adapted}} = W_{\text{base}} + \frac{\alpha}{r} \cdot B A
$$

where $A \in \mathbb{R}^{r \times d_{\text{in}}}$, $B \in \mathbb{R}^{d_{\text{out}} \times r}$, with rank $r = 4$. This requires only 5.6K parameters per player (~1.8% of the trunk), and loading a player's LoRA weights takes ~30ms (one-time cost on player switch). LoRA weights are trained via the same composite loss on player-specific data.

### 9.5 Inference and Safety

- **Inference latency**: 4–8 ms on CPU (single forward pass including mask computation).
- **Feasibility mask**: <0.05 ms (computed once per 28 shapes via `get_legal_positions`).
- **Validation gate**: The predicted triplet passes through the same constraint validation pipeline as the rule track. Any failure triggers automatic fallback.
- **Deployment**: ONNX-exported model for production serving; fallback reason is recorded in the panel diagnostics.

---

## 10. Spawn Parameter Tuning: SpawnParamTuner

### 10.1 Problem Formulation

The behavior of `SpawnPolicyRules` is governed by 36 tunable parameters $\theta \in [0,1]^{36}$ (grouped as personalization, PB tension, scoring strategy, translation, challenge modulation, order difficulty, constructive parameters, and solution space intervals). For each player context $c$ (representing a combination of lifecycle stage, maturity band, arc phase, and difficulty mode), the goal is to find the optimal parameter vector $\theta^*_c$ that produces the ideal difficulty progression curve.

### 10.2 Model Architecture

SpawnParamTuner (~200K parameters) uses a ResNet-MLP architecture:

- **Input**: context(32) concatenated with theta(36) → 68-dimensional.
- **Projection**: Linear(68→128) → GELU → unsqueeze to sequence → add learnable position embedding (20 positions).
- **Encoder**: 4× TransformerEncoder layers (d_model=128, 4 heads, FFN=256, GELU, dropout=0.1).
- **Output heads**: D(r) curve (20 bins, sigmoid), E(r) curve_e, F(r) curve_f, plus 5 auxiliary heads.

### 10.3 Bi-Level Optimization

The optimization is structured as a bi-level problem:

**Inner level** (learning the (c, θ) → d_curve mapping):

$$
\min_{\phi} \mathbb{E}_{(c,\theta) \sim \mathcal{D}}\left[\mathcal{L}_{\text{total}}(f_{\phi}(c,\theta), \text{targets})\right]
$$

**Outer level** (finding optimal θ for each context):

$$
\theta^*_c = \arg\min_{\theta \in [0,1]^{36}} \mathcal{J}(f_{\phi^*}(c, \theta))
$$

The outer search uses gradient ascent on θ (the network is treated as a differentiable surrogate model), with 8 Latin Hypercube Sampling (LHS) restarts, T=300 Adam steps at η=0.05, and projection back to [0,1]³⁶ after each step.

**Composite loss** (15 terms): shape MSE (weighted by bin), anchor hinge (22 key r-points), monotonicity, breaking, endpoint anchoring, diversity, deploy loss (θ vs ideal), auxiliary BCE/MSE, smoothness (θ sensitivity), balance (variance across PB tiers), surprise frequency (~7%), curve E/F fit, frustration cap (F ≤ 0.30 hard limit), and r-value SmoothL1.

### 10.4 Deployment

Trained policies are exported as `policies.json`, which maps each context c to its optimal θ\*_c. At runtime, `SpawnPolicyRules` looks up the player's current context and interpolates between the nearest tabled entries. This enables offline optimization with online deployment, without requiring the neural network at inference time.

---

## 11. Monetization Framework

### 11.1 Design Principle

The monetization framework operates on the principle of *experience-first monetization*: it reads the same player profile as the spawn engine and makes decisions based on the player's current state. Ads are never shown when the player is in flow or anxious states; IAP offers are timed to coincide with near-miss moments (just below PB) and relief opportunities (after a frustration spike).

### 11.2 Whale Score and Segmentation

A lightweight whale score is computed as a linear weighted combination:

$$
\text{whale\_score} = 0.4 \cdot \min\left(1, \frac{\text{best\_score}}{2000}\right) + 0.3 \cdot \min\left(1, \frac{\text{total\_games}}{50}\right) + 0.3 \cdot \min\left(1, \frac{\text{avg\_session\_sec}}{600}\right)
$$

Players are segmented into three tiers: whale (≥0.60), dolphin ([0.30, 0.60)), and minnow (<0.30). Different ad frequency caps and IAP offer types are applied per tier.

### 11.3 Decision Engine

The monetization decision engine follows a four-step pipeline: (1) **filter**—match active rules against player segments and game state conditions; (2) **render**—generate human-readable explanations of why each rule fired; (3) **sort**—prioritize active rules by priority score; (4) **explain**—produce 5–7 lines of reasoning summary for debugging and transparency.

---

## 12. Engineering and Production Infrastructure

### 12.1 Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (no framework), Vite build, Canvas/WebGL renderer |
| RL (PyTorch) | Python 3.10+, PyTorch 2.x, Numba JIT for grid operations |
| RL (MLX) | Apple MLX for Apple Silicon-optimized training |
| Backend | Python Flask, SQLAlchemy 2.0 ORM |
| Database | SQLite (development), PostgreSQL (production, `USE_POSTGRES=true`) |
| Observability | Prometheus metrics, OpenTelemetry tracing (W3C tracecontext), structured JSON logging |
| Deployment | Docker Compose (local/staging), Kubernetes + Helm (production) |

### 12.2 Cross-Platform Contract

The contract between platforms is enforced by `game_rules.json` as the single source of truth and by cross-language test suites:

- `tests/test_spawn_step_difficulty.py` ↔ `tests/spawnStepDifficulty.test.js`: shared fixture `tests/fixtures/spawnStepDifficulty.cases.json` ensures JS and Python produce identical SCD scores for the same inputs.
- `rl_pytorch/features.py` ↔ `web/src/bot/features.js`: feature encoding is manually synchronized; any change to `featureEncoding` dimensions triggers a dimension assertion that fails loudly on mismatch.

### 12.3 Build and Test Infrastructure

- **Frontend**: Vite build with `manualChunks` strategy (main bundle 500KB → 230KB, −54%), CI-enforced budget via `scripts/check-bundle-size.mjs`.
- **Backend**: Pytest (unit + integration), vitest (frontend unit), ESLint + Ruff (lint), algorithm regression tests.
- **RL**: Automated quality gate checks teacher coverage, win-rate moving average, and spawn difficulty drift before accepting new checkpoints.

### 12.4 Architecture Decision Records

Ten ADRs document key technical decisions, including:
- ADR-003: AdaptiveSpawn as a monolithic module (not microservices, to keep browser-first capability)
- ADR-005: Flat test layout (no nested directories, to simplify discovery)
- ADR-009: Bitmap WASM (performance-critical grid operations compiled to WebAssembly)

---

## 13. Evaluation and Empirical Results

### 13.1 RL Agent Training

The RL agent was trained for over 230,000 self-play episodes using the PyTorch PPO pipeline. Key results:

**Training statistics (recent 2,100 episodes):**

| Metric | Value |
|--------|-------|
| Win rate | 35.6% (748 / 2,100) |
| Mean score | 5,739 |
| Median score | 4,200 |
| P25/P75 score | 1,795 / 8,040 |
| Max score | 43,480 |
| Mean win steps | 263.7 |
| Mean loss steps | 67.3 |

The stark gap between winning (264 steps) and losing (67 steps) game lengths points to the primary failure mode: rapid board degeneration leading to unplaceable docks. This motivated the per-shape placeability auxiliary supervision (v13).

**Loss component analysis:**

| Loss Component | Mean | Correlation with Score | Correlation with Win | p-value |
|---------------|------|----------------------|---------------------|---------|
| `loss_feas` (BCE) | 0.0394 | −0.172 | −0.160 | <0.0001 |
| `loss_surv` (MSE) | 0.0215 | −0.202 | −0.170 | <0.0001 |
| `loss_bq` (MSE) | 0.0012 | +0.011 | +0.004 | 0.86 |
| `loss_spawn_diff` (pre-v13, 4-dim) | 0.0242 | −0.009 | −0.007 | 0.69 |
| `loss_policy` | 0.0671 | — | — | — |
| `loss_value` | 16.68 | — | — | — |

The feasibility and survival losses are strongly correlated with outcomes (p < 0.0001), confirming that the model's ability to predict "can I keep playing?" and "how much longer can I survive?" is the key differentiator between winning and losing episodes.

### 13.2 Spawn Difficulty Distribution

Across training episodes, the spawn difficulty bucket distribution is:

| Bucket | Proportion |
|--------|-----------|
| Standard | 59.3% |
| Hard | 32.8% |
| Extreme | 5.9% |
| Easy | 2.0% |
| Trivial | 0.02% |

Crucially, the bucket distribution is **nearly identical between won and lost games**. This confirms that the bottleneck is not the spawn difficulty per se—it is the board state's ability to accommodate the spawned pieces. The system is generating similarly difficult docks for both outcomes; the difference is that losing boards have degenerated to the point where even standard-difficulty docks become unplaceable.

### 13.3 Long-Bar Bottleneck Verification

Simulation experiments quantified the placeability of different shape categories as a function of board fill rate. Using 8×8 boards with 15% hole density (realistic game conditions), 2,000 random boards per fill level:

| Fill Rate | Long-Bars (1×4,1×5) Placeable | Non-Line Shapes Placeable | Gap | Long-Bar Zero-Position Rate |
|-----------|------------------------------|--------------------------|-----|---------------------------|
| 40% | 99.8% | 99.9% | −0.1% | 0.2% |
| 50% | 97.8% | 98.7% | −0.9% | 2.2% |
| 60% | 89.3% | 94.4% | −5.0% | 10.7% |
| 65% | 78.7% | 88.4% | −9.6% | 21.3% |
| 70% | 67.1% | 79.8% | −12.7% | 32.9% |
| 75% | 43.6% | 61.7% | −18.1% | 56.4% |
| 80% | 30.2% | 46.8% | −16.6% | 69.8% |

At fill rates ≥70% (the typical death zone for losing games), one-third to over half of long-bar pieces have zero legal positions. This confirms that 1×4 and 1×5 pieces are the first to become unplaceable as the board fills, making them the primary bottleneck for late-game survival.

### 13.4 Per-Shape Placeability Signal (v13)

The v13 upgrade to the `spawn_diff_aux` head, extending it from 4 to 12 dimensions (adding 8 per-shape placeability features), was motivated by the observation that the original 4-dimensional SCD prediction had near-zero correlation with outcomes (r = −0.009, p = 0.69). By explicitly exposing placeability counts for fixed representative shapes, the trunk learns to distinguish between "the 1×5 has 8 positions" and "the 1×5 has zero positions"—a distinction the original SCD features could not express because they only captured aggregate properties of the dock triplet, not per-board per-shape viability.

Computational cost of the per-shape placeability computation is negligible: 8 calls to `get_legal_positions` (~0.16ms with Numba JIT) versus the existing DFS feasibility check (50–200ms).

### 13.5 Cross-Language Contract Validation

All cross-language contract tests pass: the JS and Python implementations of `spawn_step_difficulty_features`, `extract_state_features`, `board_potential`, and `count_sequential_solution_leaves` produce identical outputs for shared test fixtures. This guarantees that the RL training environment (Python) is faithful to the deployment environment (JS browser).

---

## 14. Related Work

OpenBlock draws on and contributes to several research traditions:

**Programmatic Content Generation.** Togelius et al.'s Search-Based PCG framework formalized content generation as optimization in content space. OpenBlock's constructive pre-scan (C1/C2/C3) implements a specialized form of this: the search is over triplet×ordering configurations, and the objective function is the placement quality composite. Yannakakis & Togelius's Experience-Driven PCG extended the framework to use player experience models to evaluate candidate content—directly analogous to OpenBlock's use of `PlayerProfile` as a scoring function for spawn candidates.

**Adaptive Difficulty.** Csikszentmihalyi's flow channel and Yerkes-Dodson's inverted-U arousal curve provide the theoretical foundation. Hunicke's Hamlet system pioneered real-time DDA in commercial games. OpenBlock extends this tradition with a two-axis differentiation matrix (lifecycle × maturity) that modulates not just difficulty magnitude but also difficulty *type*: the system provides easier *shapes*, not just easier *placements*, to struggling players.

**Reinforcement Learning for Board Games.** AlphaZero demonstrated that self-play RL with MCTS can achieve superhuman performance. OpenBlock applies a similar architecture (policy + value network, self-play training, search distillation) but adapts it for the continuous content generation setting: the spawn difficulty serves as a curriculum, and the evaluation gate prevents regression. Unlike AlphaZero's binary win/loss terminal reward, OpenBlock uses dense scoring rewards with potential-based shaping (Ng 1999).

**Player Modeling.** Missura & Gärtner's dynamic difficulty adjustment with player models and Conati et al.'s Bayesian student modeling established the importance of explicit skill estimation. OpenBlock's player profiling system uses lightweight, interpretable heuristics (EMA smoothing, flow deviation formula) to achieve real-time operation in the browser—a pragmatic alternative to learned models that would require server-side inference.

**Transformer-Based Content Generation.** Vaswani et al.'s Transformer architecture has been adapted for content generation in multiple domains. SpawnPolicyNet applies it to the specific problem of autoregressive triplet prediction with feasibility masking—a setting where the joint distribution over three discrete choices is constrained by hard physical constraints (board geometry).

---

## 15. Limitations and Future Work

### 15.1 Current Limitations

- **Board size generalization**: The RL agent is trained exclusively on 8×8 grids. Generalization to other board sizes would require retraining or architectural changes.
- **Shape pool expansion**: SpawnPolicyNet's 28-shape vocabulary is fixed. Expanding to 40+ shapes requires retraining and possibly architectural modifications to the slot heads.
- **Heuristic player model**: The player profiling system uses hand-designed rules rather than learned models. While this is intentional (browser-first, interpretable), it may miss subtle behavioral patterns.
- **MCTS depth**: Browser-based MCTS is limited by CPU budget; search depths beyond 3–4 ply are impractical in real-time.
- **Monetization-RL integration**: Monetization signals are not currently integrated into RL reward shaping, missing an opportunity for unified optimization.
- **Single-player focus**: The system is designed for single-player puzzle play. Multiplayer or social features are not addressed.

### 15.2 Future Directions

- **Federated LoRA personalization**: Train player-specific LoRA weights on-device, uploading only aggregate statistics to preserve privacy.
- **LLM-based explainability**: Generate natural language explanations of spawn decisions using large language models, making the system's reasoning accessible to non-technical stakeholders.
- **Causal player modeling**: Move from correlational to causal models of player behavior, enabling "what if" counterfactual reasoning for spawn parameter selection.
- **Unified multi-objective RL**: Integrate spawn quality, placement quality, and monetization outcomes into a single reward function, enabling end-to-end optimization.
- **Procedural level generation**: Extend the spawn engine to generate not just individual docks but full "levels"—sequences of docks with a designed difficulty arc.

---

## 16. Appendix

### A. Glossary

| Term | Definition |
|------|-----------|
| **Spawn** | The generation of a candidate dock triplet |
| **Dock** | The 3 candidate blocks simultaneously displayed to the player |
| **SCD** (Spawn Step Difficulty) | 0–1 normalized difficulty score for a dock triplet |
| **DFS Solvability** | Depth-first search verification that all dock blocks have a legal placement ordering |
| **Flow** | Optimal experience state where perceived challenge ∼ perceived skill |
| **RoR** (Rate of Return) | Between-game difficulty progression arc |
| **25-Grid** | Lifecycle stage (S0–S4) × Maturity band (M0–M4) differentiation matrix |
| **LoRA** | Low-Rank Adaptation for parameter-efficient model personalization |
| **GAE** | Generalized Advantage Estimation (Schulman et al., 2015) |
| **PPO** | Proximal Policy Optimization (Schulman et al., 2017) |
| **EMA** | Exponentially Weighted Moving Average |

### B. Configuration Reference

Key sections of `shared/game_rules.json`:

- `featureEncoding.stateScalarDim` (65), `featureEncoding.maxGridWidth` (8), `featureEncoding.dockSlots` (3)
- `adaptiveSpawn.profileLevels` (10-tier shape weights), `adaptiveSpawn.constructiveSpawn`
- `rlRewardShaping.potentialShaping`, `rlRewardShaping.boardQualityLossCoef` (0.5), `rlRewardShaping.feasibilityLossCoef` (0.3), `rlRewardShaping.spawnDiffAux` (12-dim, coef=0.05)
- `clearScoring.single_line` (20), `clearScoring.comboMultiplier`, `clearScoring.iconBonusLineMult` (5)

### C. API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rl/select_action` | POST | RL placement inference |
| `/api/rl/eval_values` | POST | 1-step lookahead value evaluation |
| `/api/spawn-model/v3/predict` | POST | Neural spawn triplet prediction |
| `/api/spawn-model/v3/personalize` | POST | LoRA weight training for a player |
| `/api/evaluation/session` | GET | Session quality evaluation |
| `/api/evaluation/ror_audit` | GET | Between-game difficulty audit |

### D. Reproduction Checklist

**Environment**: Python 3.10+, Node 20+, PyTorch 2.x, Numba 0.58+.

**RL training:**
```bash
pip install -r requirements-rl.txt
python -m rl_pytorch.train --device cpu --arch conv-shared --batch-episodes 256
```

**Spawn model training:**
```bash
python -m rl_pytorch.spawn_model.train_v3
```

**Frontend dev server:**
```bash
npm install && npm run dev
```

**Cross-language contract tests:**
```bash
npx vitest run tests/spawnStepDifficulty.test.js
python -m pytest tests/test_spawn_step_difficulty.py -v
```

### E. References

1. Schulman, J., Wolski, F., Dhariwal, P., Radford, A., & Klimov, O. (2017). Proximal Policy Optimization Algorithms. *arXiv:1707.06347*.
2. Schulman, J., Moritz, P., Levine, S., Jordan, M., & Abbeel, P. (2015). High-Dimensional Continuous Control Using Generalized Advantage Estimation. *arXiv:1506.02438*.
3. Silver, D., et al. (2018). A general reinforcement learning algorithm that masters chess, shogi, and Go through self-play. *Science*, 362(6419), 1140–1144.
4. Silver, D., et al. (2017). Mastering the game of Go without human knowledge. *Nature*, 550, 354–359.
5. Vaswani, A., et al. (2017). Attention Is All You Need. *Advances in Neural Information Processing Systems*, 30.
6. Hu, E. J., et al. (2021). LoRA: Low-Rank Adaptation of Large Language Models. *arXiv:2106.09685*.
7. Csikszentmihalyi, M. (1990). *Flow: The Psychology of Optimal Experience*. Harper & Row.
8. Yannakakis, G. N., & Togelius, J. (2011). Experience-driven procedural content generation. *IEEE Transactions on Affective Computing*, 2(3), 147–161.
9. Togelius, J., Yannakakis, G. N., Stanley, K. O., & Browne, C. (2011). Search-based procedural content generation: A taxonomy and survey. *IEEE Transactions on Computational Intelligence and AI in Games*, 3(3), 172–186.
10. Ng, A. Y., Harada, D., & Russell, S. (1999). Policy invariance under reward transformations: Theory and application to reward shaping. *ICML*.
11. Hunicke, R. (2005). The case for dynamic difficulty adjustment in games. *ACM SIGCHI International Conference on Advances in Computer Entertainment Technology*.
12. Missura, O., & Gärtner, T. (2009). Player modeling for intelligent difficulty adjustment. *Discovery Science*.
13. Pasqualotto, A., et al. (2024). Multidimensional DDA in Legends of Hoa'Manu. EPFL/UNIGE Technical Report.

---

> **Document version**: v1.0 | **Generated**: 2026-07-01 | **License**: MIT
>
> This technical report is a living document. The authoritative, always-up-to-date documentation for each subsystem resides in the source-linked documents listed in each chapter's header. This report provides a unified narrative suitable for researchers, engineers, and reviewers evaluating the OpenBlock platform as a whole.
