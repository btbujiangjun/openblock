# 彩蛋与惊喜系统

> 上下文：见 [`SKINS_CATALOG.md`](./SKINS_CATALOG.md) 与 [`DOMAIN_KNOWLEDGE.md`](../domain/DOMAIN_KNOWLEDGE.md)。

休闲游戏的核心壁垒是「积累的惊喜」。本系统盘活 36 款皮肤的视觉资产与反馈管线，在不改动核心玩法的前提下，让玩家初玩即感「有灵魂」、长期玩有理由回流。

---

## 一、总览

| 编号 | 模块 | 文件 | 体感 | 工时 |
|------|------|------|------|------|
| S1.1 | 程序化音效 | `web/src/effects/audioFx.js` | 8 种基础事件（place/clear/multi/combo/perfect/bonus/unlock/tick），无音频资产 | 1d |
| S1.1 | 皮肤主题声效 | `web/src/effects/skinSoundPalettes.js` / `miniprogram/utils/audioFx.js` | 每款皮肤按主题生成材质点击、消行音阶、连击递进、主题动机与解锁音色，并随皮肤同步切换 | 0.5d |
| S1.1 | 设备震动 | `web/src/effects/audioFx.js` | 6 种触觉模式，移动端默认开 | 0.2d |
| S1.1 | 用户偏好开关 | `web/src/effects/audioFx.js` + `game.cheat` | 音效 / 触觉 / 音量三档 localStorage 持久化 | 0.3d |
| S1.2 | 皮肤切换转场 | `web/src/effects/skinTransition.js` | 0.6s 主题色一闪 + 淡入淡出 + unlock 音效 | 0.5d |
| S1.3 | 皮肤环境粒子层 | `web/src/effects/ambientParticles.js` | 5 款示范（樱花/落叶/气泡/萤火虫/流星）| 2d |
| S2.1 | 节日自动换皮 | `web/src/seasonalSkin.js` | 12 个节日 → 对应皮肤 toast 推荐 | 1d |
| S2.1 | 时段自动换皮 | `web/src/seasonalSkin.js` | 7 时段（早曙/上午/午后/夕阳/夜/深夜）默认体验动态化 | 0.3d |
| S2.1 | 4.1 emoji 限定 | `web/src/seasonalSkin.js` | 全 36 款 blockIcons 临时替换为表情 emoji | 0.5d |
| S2.2 | Konami 隐藏皮肤 | `web/src/easterEggs.js` | ↑↑↓↓←→←→BA → 解锁第 37 款 OG 几何 | 0.7d |
| S2.2 | 数字彩蛋 | `web/src/easterEggs.js` | 1234/4321/8888/6666/12345/65535 → 短特效 | 0.3d |
| S2.2 | 控制台 cheat | `web/src/easterEggs.js` | `window.openBlockGame.cheat.help()` | 0.3d |

**总工时：~7.1d** | **代码新增：5 个模块 / 1234 LoC** | **改动既有文件：6 处 / ≤ 25 行**

---

## 二、架构：零侵入接入

> **设计哲学**：所有彩蛋模块都通过「装饰器（renderer 方法 / setActiveSkinId）」或「外挂渲染钩子（renderer.renderAmbient）」接入，game.js 仅新增 1 行调用。

```text
┌──────────────────────────────────────────────────────────────┐
│  main.js (DOMContentLoaded)                                  │
│   1. applyAprilFoolsIfActive()      // 改 SKINS[*].blockIcons │
│   2. applySkinToDocument(skin)      // 已有                  │
│   3. createAudioFx()                // 单例 / 懒 AudioContext │
│   4. installSkinTransition({audio}) // 装饰 setActiveSkinId   │
│   5. (init game) → game.renderer 就绪                          │
│   6. audioFx.attachToRenderer(renderer)  // 装饰 trigger* 方法 │
│   7. createAmbientParticles({renderer})                       │
│   8. renderer.setAmbientLayer(ambient)                        │
│   9. await game.init()                                       │
│  10. applySeasonalRecommendation({game, audio})              │
│  11. initEasterEggs({game, audio})                            │
└──────────────────────────────────────────────────────────────┘

每帧渲染（game.render()）：
  renderer.clear()
  renderer.renderBackground()
  renderer.renderEdgeFalloff()
  renderer.renderAmbient()      （环境粒子）
  renderer.renderGrid(grid)
  …
```

---

## 三、模块详解

### 3.1 程序化音效 + 触觉（`audioFx.js`）

#### 音色清单

| 类型 | 触发场景 | 振荡器 | 频率轨迹 | 时长 | 增益 |
|------|----------|--------|----------|------|------|
| `place` | 落子 | sine | 700→480 Hz | 60 ms | 0.10 |
| `clear` | 单次消行 | triangle | 1200→800 Hz | 160 ms | 0.16 |
| `multi` | 同时清 ≥2 行 | triangle + sine | 1100↗1500 → 1500↘1100 | 220 ms | 0.14 |
| `combo` | 三行及以上多消 | triangle + sine | 低声蓄力 → 3-5 段顺序上扬庆祝音 + 高音尾（不叠音） | ~650 ms | 0.035-0.12 |
| `perfect` | 盘面清空 | noise + sine/triangle | 低频冲击波 + 明亮上扬号角 + 高音尾 | ~1.4s | 0.035-0.10 |
| `bonus` | 同色 / 同 icon 整行 | noise + triangle/sine | 爆炸冲击 + 明亮号角 + 短促喊声 + 碎裂掌声（无丝丝长尾） | ~1.6s | 0.012-0.12 |
| `unlock` | 皮肤切换 / Konami | sine + triangle | 600↗1200 / 1200↗1800 | 600 ms | 0.14 |
| `tick` | 菜单点击 | sine | 880 Hz 恒定 | 30 ms | 0.06 |

#### 触觉清单（`navigator.vibrate`）

| 类型 | 模式（ms） |
|------|-----------|
| `place` | `8` |
| `clear` | `20` |
| `multi` | `[10, 30, 10]` |
| `combo` | `[15, 40, 15, 40]` |
| `perfect` | `[40, 80, 40, 80, 40]` |
| `bonus` | `[10, 20, 10]` |

#### 关键设计

- **懒加载**：`AudioContext` 只在首次 `pointerdown / keydown / touchstart` 后创建，避开 Chrome autoplay 警告。
- **接入：装饰 renderer**：`audioFx.attachToRenderer(renderer)` 包装 `triggerPerfectFlash / triggerComboFlash / triggerBonusMatchFlash / triggerDoubleWave / setClearCells` 五个方法，**保留原行为**，让 game.js 零改动联动。
- **降速门**：连续 12ms 内多次 `play()` 仅响应一次（防 combo 短时间重复触发刺耳）。
- **prefers-reduced-motion**：开启时禁用震动、保留音效（用户可单独控制）。

#### 用户偏好 API（控制台 / 设置面板）

```js
window.__audioFx.setEnabled(false);   // 关音效
window.__audioFx.setHaptic(false);    // 关震动
window.__audioFx.setVolume(0.3);      // 音量 0..1
window.__audioFx.getPrefs();          // { sound, haptic, volume }
```

存储 key：`openblock_audiofx_v1`。

#### 皮肤主题声效（`skinSoundPalettes.js`）

`skinSoundPalettes.js` 不再只为少数皮肤手写 `clear/combo/bonus`，而是为每款当前皮肤声明一条 `SKIN_SOUND_THEMES` 配置，并在运行时生成 8 个核心事件的音色函数：

- `place`：根据主题材质生成落子确认音，如金属、玻璃、水滴、木质、像素、麻将牌、软弹玩具。
- `clear / multi / combo`：根据主题根音与音阶生成单消、多消、连击递进，连击段数随 `streak` 增长。
- `perfect / bonus`：保留最高奖励感，但使用当前皮肤的音阶、空气噪声和冲击层，避免所有皮肤听起来一样。
- `unlock / tick`：皮肤切换转场中的 `unlock` 和 UI 点击也跟随主题，保证“换了一个世界”的听感闭环。
- **主题动机音**：不克隆商业素材，只参考业内经典声效的功能语义，原创合成麻将双击牌声、海洋气泡滑音、森林鸟鸣/叶响、紫禁城锣尾、像素短方波、宇宙上扫、咖啡杯木质轻敲等短动机。

同步机制：

1. `main.js` 创建 `audioFx` 后调用 `initSkinSoundPalettes({ audioFx })`。
2. 初始化时读取 `getActiveSkinId()`，立即安装当前皮肤的主题音色。
3. 订阅 `onSkinAfterApply`，在 `setActiveSkinId()` 真正应用主题后替换 `audioFx._tonePlace/_toneClear/...`。
4. `skinTransition.js` 在 `applyImmediate()` 之后播放 `unlock`，因此转场解锁音会使用新皮肤音色。

小程序端同步：

- `miniprogram/utils/audioFx.js` 提供 `setSkinTheme(skinId)` / `getSkinTheme()`，按当前皮肤重建程序化 WAV 的 sound defs。
- 主菜单 `pages/index/index.js` 在 `onLoad` 和 `onSkinChange` 调用 `setSkinTheme()`；游戏页 `pages/game/game.js` 在读取 query skin / 当前皮肤后调用。
- 切换主题会清空已生成音效缓存，下一次 warmup/play 使用新皮肤音色重新生成 WAV。
- 小程序 `sound` 与 `haptic` 跟随 Web 契约联动：关闭音效即关闭触觉；重新开启音效同时恢复触觉。
- 切换皮肤时小程序同样播放 `unlock`，与 Web `skinTransition.js` 的换肤仪式声保持事件一致。

维护规则：

- 新增皮肤时必须在 `SKIN_SOUND_THEMES` 中补一条配置，单测会校验所有 `SKINS` 都有声音主题。
- 优先复用 `PRESETS`（如 `water / metal / cute / magic / royal`），只有主题听感真的不同才新增 preset。
- 声音主题只描述“材质 + 根音 + 音阶”，不要在玩法模块里直接判断皮肤 id。
- 不直接复制/克隆业内游戏的受版权保护音频；若后续引入音频文件，必须使用自制或授权素材，并保持程序化音效作为 fallback。

#### 外部音频测试覆盖层

为了便于调研阶段 A/B 听感，Web 与小程序都支持“外部文件优先、程序化音效兜底”：

Web 端目录约定（Vite public 根）：

```text
web/public/audio/skins/<skinId>/<event>.ogg
web/public/audio/skins/<skinId>/<event>.mp3
web/public/audio/skins/<skinId>/<event>.wav
web/public/audio/skins/<skinId>/<event>.m4a
web/public/audio/skins/_themes/<motif>/<event>.ogg
web/public/audio/skins/_themes/<motif>/<event>.mp3
web/public/audio/skins/_themes/<motif>/<event>.wav
web/public/audio/skins/_themes/<motif>/<event>.m4a
```

小程序端目录约定（包内静态资源）：

```text
miniprogram/assets/audio/skins/<skinId>/<event>.ogg
miniprogram/assets/audio/skins/<skinId>/<event>.mp3
miniprogram/assets/audio/skins/<skinId>/<event>.wav
miniprogram/assets/audio/skins/<skinId>/<event>.m4a
miniprogram/assets/audio/skins/_themes/<group>/<event>.ogg
miniprogram/assets/audio/skins/_themes/<group>/<event>.mp3
miniprogram/assets/audio/skins/_themes/<group>/<event>.wav
miniprogram/assets/audio/skins/_themes/<group>/<event>.m4a
miniprogram/assets/audio/skins/_groups/<group>/<event>.ogg
miniprogram/assets/audio/skins/_groups/<group>/<event>.mp3
miniprogram/assets/audio/skins/_groups/<group>/<event>.wav
miniprogram/assets/audio/skins/_groups/<group>/<event>.m4a
```

事件名：`place / clear / multi / combo / perfect / bonus / unlock / tick`；小程序额外支持 `select / gameOver`。小程序会优先查 `<skinId>`，再查 `_themes/<group>`，最后兼容旧 `_groups/<group>`。

运行逻辑：

- Web：`skinSoundPalettes.js` 在首次有 `AudioContext` 后尝试解码候选文件；已解码文件优先播放，缺失则用程序化版本。
- 小程序：`audioFx.js` 先尝试包内文件（扩展名顺序与 Web 对齐为 `.ogg/.mp3/.wav/.m4a`），`InnerAudioContext.onError` 后记录缺失并回退生成 WAV。
- 调试关闭：设置 `window.__openBlockDisableExternalAudioAssets = true`（Web）或 `globalThis.__openBlockDisableExternalAudioAssets = true`（小程序）。
- 自定义根目录：设置 `window.__openBlockAudioAssetBase` / `globalThis.__openBlockAudioAssetBase`。

当前研究素材：

- 已导入 Kenney Interface Sounds（CC0 1.0），原始包保存在 `docs/research/audio/kenney-interface-sounds/`。
- 已导入 Kenney UI Audio（CC0 1.0），原始包保存在 `docs/research/audio/kenney-ui-audio/`。
- 已导入 Kenney Casino Audio（CC0 1.0），原始包保存在 `docs/research/audio/kenney-casino-audio/`；麻将主题只允许柔和桌面物件声（`cardPlace/cardSlide/chipLay/chipsStack/chipsHandle`），高频 `place/tick/select/clear` 禁止 `chipsCollide/diceThrow/dieThrow`。
- 已导入 rubberduck Water/Splash/Slime SFX（CC0），原始包保存在 `docs/research/audio/rubberduck-water-splash-slime/`；用于 `ocean / koi / summer / water` 等水域主题的气泡、水花和短水声反馈。
- 已导入 rubberduck Creature SFX（CC0），原始包保存在 `docs/research/audio/rubberduck-creature-sfx/`；用于 `pets / forest / jurassic` 等自然、动物、拟人主题的 `cute/bug/ooh/nose` 等柔和短声，普通反馈禁用 `misc/bark/barking/howl/monster/roar/scream/hurt/cough/burp/snore/breath/burble/spit` 以及 `poof/pfft/fart/deflate/balloon` 这类气球泄气感来源。
- `fairy / fantasy / magic` 主题单独使用 Kenney Interface 的 `pluck/glass/select/drop` 清亮素材，`place/tick/select/clear` 不再使用任何 creature、宠物声、长空气噪声或 `confirmation/open` 这类阶梯式成功提示音，避免花仙梦境出现狗叫感、魔幻秘境消行出现气球泄气感或琶音感。
- 统一许可说明保存在 `docs/research/audio/KENNEY_AUDIO_IMPORTS_LICENSE.txt`。
- 筛选规则保存在 `docs/research/audio/CURATION_NOTES.md`。
- 当前全局筛选 manifest 保存在 `docs/research/audio/audio_mapping_manifest.json`，主题重映射清单保存在 `docs/research/audio/theme_audio_mapping_manifest.json`，审计结果保存在 `docs/research/audio/theme_audio_audit_report.json`。
- 审计/重映射脚本：`docs/research/audio/audit_theme_audio.py` 与 `docs/research/audio/remap_theme_audio.py`。
- Web 映射文件位于 `web/public/audio/skins/`，小程序映射文件位于 `miniprogram/assets/audio/skins/`。
- 这些文件用于研究试听与 A/B 调参；可直接替换同名事件文件以测试其它来源素材。
- 当前映射规则偏“清脆、明亮、悦耳”：过滤 `glitch/scratch/error/bong/close/minimize/back`，避免把 `click/tick` 命名素材用于映射，也排除 `misc/bark/barking/breath/burble/spit/poof/pfft/fart/deflate/balloon` 这类粗糙、拟动物、气球泄气或噗呲感来源，并要求最短时长阈值（`place` ≥ 120ms，`tick/select` ≥ 100ms，`clear` ≥ 160ms，`combo/perfect/bonus` 更长），以移除短促刺耳、过度低沉和廉价泄气感反馈。
- 当前主题映射偏“内容相关”：麻将只取牌桌/瓷牌/软筹码放置声；水域主题只取 bubble/splash/water/rain，常规落子不使用 slime；恐龙与森林分离，`jurassic` 只用 jungle/wood/leaf/soft creature 语义，`forest` 使用 leaf/bird/wood/bug/cute 语义；宠物使用 cute/nose/ooh，不用 bark/howl/monster；暗黑主题只保留张力，不用低沉收束或嘶哑怪叫作为高频反馈。
- 程序化 fallback 也遵循同一标准：主题奖励不再使用低通低频冲击层，非暗黑主题避免向下低频扫动，奖励尾音以短促上扬层和轻空气颗粒为主。
- 全局移除琶音类反馈：不使用分解和弦、连续阶梯上行音、score-lift arp 或自带阶梯成功提示感的外部素材；需要奖励感时使用同时起音的短和弦、玻璃闪光或材质尾音。
- 高奖励事件即使命中外部文件，也会叠加程序化上扬层：`multi/combo/perfect/bonus` 的 score lift 会随 combo/bonus 规模增加段数和空气感。

---

### 3.2 皮肤切换转场（`skinTransition.js`）

#### 时间线

```text
t=0      用户点击皮肤选项 / 节日 toast 切换
t=0      overlay 设为目标皮肤 cssBg，opacity=0
t=0      触发 transition: opacity 300ms ease，opacity → 0.85
t=300ms  setActiveSkinId(id) 实际生效（cssVars 替换发生在淡入峰值，被覆盖）
         同时播放 unlock 音效
t=300ms  触发 transition: opacity 300ms ease，opacity → 0
t=600ms  overlay 复位，transition 清除
```

#### 关键设计

- **零侵入**：通过 `installSkinTransition()` 装饰 `setActiveSkinId`（保留原方法 + 加转场动画），其他模块（settings 面板 / Konami / seasonal）调用方式完全不变。
- **可重入**：连续触发会以最新主题色重启动画，不会累积（依赖 CSS transition 自身合并）。
- **降级**：`prefers-reduced-motion` 用户直接调原 `setActiveSkinId`，跳过过渡。
- **DOM 元素**：`#skin-transition-overlay`，由 `index.html` 预置；CSS 在 `main.css` 第 3899 行。

---

### 3.3 皮肤环境粒子层（`ambientParticles.js`）

#### 5 款示范预设

| 皮肤 | 粒子类型 | 动画 | 同屏数 | 平均 alpha |
|------|----------|------|--------|------------|
| `sakura` | 樱花瓣（粉色椭圆） | 旋转 + 下落 | 12 | 0.52 |
| `forest` | 落叶（橙黄椭圆 + 叶脉） | 旋转 + 下落 | 10 | 0.54 |
| `ocean`  | 气泡（白色透明圆） | 上浮 + 横向扰动 | 14 | 0.44 |
| `fairy`  | 萤火虫（径向渐变发光圆） | 漂浮 + 呼吸 | 10 | 0.59（脉动） |
| `universe` | 流星（白色拖尾 + 顶点圆） | 斜向高速 | 8 | 0.75 |

> 其余 31 款皮肤 `applySkin(skinId)` 后 `preset = null`，每帧 `tickAndRender` 早返回，**零开销**。

#### 关键设计

- **复用 fxCanvas**：在特效画布（`#game-grid-fx`）上绘制，享受 4 边羽化 mask（粒子飞出盘面会自然消散，不会撞硬边界）。
- **生命周期**：粒子飞出 fxCanvas 边界（含 paintMargin）即销毁，以恒定流量补充新粒子保持密度。
- **皮肤切换响应**：`game.js` 在皮肤切换处调用 `window.__ambientParticles.applySkin(newSkinId)`，立即清空旧粒子并加载新预设（避免视觉污染）。
- **用户偏好**：`window.__ambientParticles.setEnabled(false)` 全局关闭；`setDensity(0.5)` 减半密度（性能档）。

#### 接入 renderer

```js
// renderer.js
setAmbientLayer(layer) { this._ambientLayer = layer; }
renderAmbient() {
    if (!this._ambientLayer || !this.fxCtx) return;
    this._ambientLayer.tickAndRender(this.fxCtx, {
        logicalW: this.logicalW,
        logicalH: this.logicalH,
        paintMargin: this._paintMargin || 0,
        cellSize: this.cellSize,
    });
}

// game.js render() 内
this.renderer.renderAmbient();
```

---

### 3.4 节日 / 时段 / 4.1 自动换皮（`seasonalSkin.js`）

#### 节日表（覆盖 2026-2028）

| 节日 | 触发日期 | 推荐皮肤 |
|------|----------|----------|
| 元旦 | 1.1 | `sakura` |
| 春节 | 农历正月初一（2026-02-17 / 2027-02-06 / 2028-01-26） | `forbidden` |
| 元宵 | 农历正月十五 | `mahjong` |
| 情人节 | 2.14 | `candy` |
| 清明 | 4.5 前后 | `forest` |
| 端午 | 农历五月初五 | `koi` |
| 中秋 | 农历八月十五 | `koi` |
| 国庆 | 10.1 | `forbidden` |
| 万圣节 | 10.31 | `demon` |
| 感恩节 | 11 月第四个周四 | `farm` |
| 圣诞节 | 12.25 | `fairy` |
| 跨年夜 | 12.31 | `aurora` |

> 节日推荐以 toast 形式呈现，含「切换」按钮。**用户当日已弹过则不再打扰**（`openblock_seasonal_v1.lastShown = ymd`）。

#### 时段映射（系统本地时间）

| 时段 | 推荐皮肤 |
|------|----------|
| 06-09 早曙 | `dawn` |
| 09-12 上午 | `ocean` |
| 12-17 午后 | `candy`（彩虹氛围） |
| 17-19 日落 | `sunset` |
| 19-22 夜晚 | `sakura`（樱花夜） |
| 22-06 深夜 | `universe` |

> **仅当用户从未主动选过任何皮肤时启用**（用 `openblock_skin_user_chosen` 标记）。一旦在皮肤选择面板中选过任意皮肤，该 flag 写入 `1`，时段动态切换永久关闭。

#### 4.1 emoji 限定模式

```text
触发：4 月 1 日（系统本地时间）
效果：所有 36 款皮肤的 blockIcons 临时替换为
      ['😀', '😎', '🤩', '😜', '🥳', '🤖', '👻', '🎭']
关闭：localStorage 设 openblock_april_fools_optout = '1'
```

> 4.1 优先级最高（覆盖节日和时段推荐）。
> 该 override 仅作用于内存中的 `SKINS[*].blockIcons`，不持久化到 localStorage，第二天自动恢复。

---

### 3.5 隐藏彩蛋（`easterEggs.js`）

#### Konami Code

序列：`↑ ↑ ↓ ↓ ← → ← → b a`（小写或大写均可）

效果：
1. 注册第 37 款隐藏皮肤 `og_geometry`（黑底白方，纯几何，致敬 Tetris 1984）到 `SKINS` 字典
2. 立即切换到该皮肤（享受 0.6s 转场动画 + unlock 音效）
3. 弹出居中飘字 toast「已解锁开发者隐藏皮肤：OG 几何」（4.5s 后淡出）
4. localStorage `openblock_konami_unlocked = '1'`，**永久解锁**（皮肤选择面板可识别后展示）

#### 数字彩蛋（分数里程碑）

| 分数 | 飘字 | 触发音 / 视觉 |
|------|------|---------------|
| 1234 | 神奇数字 1234 | bonus 音 + 2× bonus 闪光 + [10,20,10] 震动 |
| 4321 | 逆序四连 4321 | 同上 |
| 8888 | 八八大顺 8888 | 同上 |
| 6666 | 六六大顺 6666 | 同上 |
| 12345 | 逐级登顶 12345 | 同上 |
| 65535 | 极客致敬 65535 | 同上 |

实现：350ms 轮询 `game.score`，每个里程碑单局仅触发一次（`triggered` Set），新局开始时（`game.start` 装饰）清空。

#### 控制台 cheat 命令

`window.openBlockGame.cheat.help()` 列出全部命令：

```js
game.cheat.god()        // perfect flash + 5× bonus 振奋特效
game.cheat.unlock()     // 强制解锁 OG 几何隐藏皮肤
game.cheat.skins()      // 列出全部皮肤 id
game.cheat.skin(id)     // 切换到指定皮肤（含隐藏皮肤）
game.cheat.sound(true|false)
game.cheat.haptic(true|false)
game.cheat.ambient(true|false)
game.cheat.about()      // 致谢
```

---

## 四、UI 元素清单

| 元素 ID | 用途 | 位置 | 隐藏机制 |
|---------|------|------|----------|
| `#skin-transition-overlay` | 皮肤切换 0.6s 主题色一闪 | `body` 直接子节点；`z-index: 9000` | opacity=0 时不可见 |
| `#seasonal-toast` | 节日推荐条幅 | `body` 直接子节点；顶部居中；`z-index: 9100` | opacity=0 + transform |
| `#easter-egg-toast` | Konami / 里程碑飘字 | `body` 直接子节点；屏幕中心；`z-index: 9200` | opacity=0 + scale(0.86) |

CSS 在 `web/public/styles/main.css` 末尾的彩蛋系统 UI 章节。
所有元素均尊重 `prefers-reduced-motion`（无障碍：禁用过渡）。

---

## 五、测试验证

### 单元测试覆盖（已规划，未在本 sprint 强制写）

> 当前 467 测试全量通过（lint 无新错）。建议下一波加：

- `audioFx.test.js`：偏好持久化 / 节流 / `attachToRenderer` 装饰幂等
- `seasonalSkin.test.js`：节日匹配 / 时段匹配 / 4.1 emoji 覆盖 / `userChosen` 反打扰
- `easterEggs.test.js`：Konami 序列识别 / 数字彩蛋去重 / 隐藏皮肤注册

### 手动验收 checklist

- [ ] 浏览器打开 → 听到 / 摸到落子反馈
- [ ] 点皮肤选择 → 0.6s 主题色一闪 + 不丢弃任何粒子
- [ ] 切到 sakura / forest / ocean / fairy / universe 任一款 → 看到对应环境粒子
- [ ] 控制台 `__audioFx.setEnabled(false)` → 音效消失
- [ ] 控制台 `__ambientParticles.setEnabled(false)` → 环境粒子消失
- [ ] 控制台输入 ↑↑↓↓←→←→ba → 看到 OG 几何皮肤 + 飘字
- [ ] 控制台 `openBlockGame.cheat.help()` → 输出命令清单
- [ ] 系统时间设为 4.1 → 重新加载 → 所有皮肤的方块 icon 变 emoji 表情
- [ ] 系统时间设为节日（如 12.25）→ 重新加载 → 顶部弹「圣诞快乐——奇幻仙境」toast

---

## 六、路线图剩余项（S3–S6）

> 已完成 S1 + S2 = 9 项 P0；剩余 **26 项**（11 P0 + 15 P1/P2）。完整清单见 `canvases/easter-eggs-roadmap.canvas.tsx`。

下一波建议：

- **S3 留存沉淀**（~6d）：7 日签到日历 + 限定皮肤试穿券、宝箱（消行掉宝）、皮肤碎片合成
- **S4 道具与策略**（~6d）：撤销 / 提示 / 炸弹 / 同色清扫，与 monetization 联动
- **S5 社交分享**（~5d）：每日挑战分享卡（Replay 预览）、好友 PK、Replay 广场（合作 RL 录像）
- **S6 生活化叙事**（~7d）：每日运势卡、关卡剧情、皮肤背景故事

---

## 七、性能与兼容性

| 指标 | 影响 |
|------|------|
| 主线程开销 | 环境粒子 ≤ 14 粒 × 简单 fillRect → < 0.5ms / 帧 |
| 内存 | 单例 ~3KB（粒子数组）+ AudioContext ~12KB |
| 包体 | 5 个新模块 ~28KB（gzip ~9KB） |
| 兼容 | 不支持 Web Audio 浏览器 → 静默降级；不支持 `navigator.vibrate` → 静默降级；不支持 CSS mask → fxCanvas 仍可见但边界不羽化 |

---

## 八、道具与运营系统

### 9.1 新建模块清单（19 个文件 / ~3500 LoC）

| 类目 | 文件 | 说明 |
|------|------|------|
| **通货** | `web/src/skills/wallet.js` | 统一钱包：hint/undo/bomb/rainbow token + coin + 试穿券；每日免费配额 + 事件总线 |
| **道具栏** | `web/src/skills/skillBar.js` | 在 `#skill-bar` 旁注册新技能按钮（不抢占现有 hint/restart/new-game），自动徽章 |
| **道具** | `web/src/skills/hintEconomy.js` | 长按 dock 方块查看推荐落点（消耗 hintToken，每日免费 3 次）|
| **道具** | `web/src/skills/undo.js` | 撤销最近一次落子（消耗 undoToken，每日免费 3 次；关卡模式禁用防作弊）|
| **道具** | `web/src/skills/bomb.js` | 瞄准模式 → 点击格子清除 3×3，每格 +5 分 |
| **道具** | `web/src/skills/rainbow.js` | 瞄准模式 → 染整行为主色，触发 bonus 同色行 |
| **签到** | `web/src/checkin/checkInPanel.js` | 7 日签到日历，第 7 天大奖 = 24h 限定皮肤试穿券 |
| **签到** | `web/src/checkin/loginStreak.js` | 连登勋章（7 / 30 / 100 / 365 天里程碑 + 道具奖励）|
| **宝箱** | `web/src/rewards/endGameChest.js` | 局末宝箱：5% 基础概率 + 12 局保底；普通 70% / 稀有 25% / 史诗 5% |
| **宝箱** | `web/src/rewards/luckyWheel.js` | 周末转盘（每周一 / 周五各 1 次免费），8 段奖池 |
| **宝箱** | `web/src/rewards/seasonChest.js` | 赛季阶梯宝箱：1k / 5k / 12k / 25k XP 解锁 4 档 |
| **社交** | `web/src/social/shareCard.js` | Canvas 经程化合成分享海报（盘面缩略 + 分数 + 皮肤名 + 二维码占位） |
| **社交** | `web/src/social/dailyMaster.js` | 每日大师题（FNV-1a hash(ymd) → mulberry32 PRNG 注入 spawnFn）|
| **社交** | `web/src/social/asyncPkStub.js` | 异步盘面挑战（P2 骨架 — 待 server.py 表 + URL 路由）|
| **社交** | `web/src/social/replayAlbumStub.js` | Top 10 棋谱本地保存（P2 骨架 — 真回放重现待补）|
| **特效** | `web/src/effects/firstUnlockCelebration.js` | 首次切到某皮肤时 perfect flash + bonus 闪光 + 飘字 |
| **特效** | `web/src/effects/skinSoundPalettes.js` | 皮肤主题声效生成器：所有现役皮肤按材质、根音、音阶生成 `place/clear/multi/combo/perfect/bonus/unlock/tick` |
| **特效** | `web/src/effects/seasonalBorder.js` | 节日盘面边缘流动彩带（春节 / 圣诞 / 万圣 / 跨年等 11 个节日）|
| **特效** | `web/src/effects/bgmStub.js` | 程序化皮肤氛围层：首次交互后低音量播放水泡、森林、麻将、宇宙、节庆等短环境动机，并随皮肤切换 |
| **成就** | `web/src/achievements/extremeAchievements.js` | 6 项极限挑战（神之手 / 万象 / 雷光 / 荣誉 / 百战 / 千锤）|
| **图鉴** | `web/src/lore/skinLore.js` | 36 款皮肤剧情背景故事图鉴 + 翻页 UI |
| **玩法** | `web/src/playmodes/rotationStub.js` | 旋转方块（P2 骨架 — game.js 集成与 hintEngine 重训待）|
| **天气** | `web/src/seasonalSkin.weather.js` | 天气感知换皮（P2 骨架 — 待 navigator.geolocation + open-meteo 接入）|
| **伙伴** | `web/src/companion/companionStub.js` | 角色养成虚拟伙伴（P2 骨架 — 待 SVG/sprite 立绘资产）|

### 9.2 改动既有文件

| 文件 | 变更行数 | 说明 |
|------|----------|------|
| `web/src/main.js` | ~50 | 接入 19 个新模块的 init |
| `web/src/skins.js` | +18 | 新增 `onSkinAfterApply` 订阅器（独立于 transition hook，多订阅者并存）|
| `web/src/seasonalSkin.js` | +120 | 周末活动皮肤 / 生日皮肤 / 工具函数 |
| `web/src/effects/ambientParticles.js` | +60 | aurora-band / ripple 流体背景预设 + 渲染 |
| `web/public/styles/main.css` | +400 | 7 套新 UI 样式（道具栏 / 签到 / 宝箱 / 转盘 / 海报 / 图鉴 / 瞄准模式 cursor）|

### 9.3 核心交互流

#### 通货流（钱包统一管理）
```text
[ 收入端 ]                                      [ 支出端 ]
  签到日历     ─┐                          ┌─→  长按方块（hintToken）
  局末宝箱     ─┤                          ├─→  点撤销按钮（undoToken）
  周末转盘     ─┤  → walletStore.add ──────┼─→  炸弹瞄准点击（bombToken）
  赛季宝箱     ─┤                          ├─→  彩虹瞄准点击（rainbowToken）
  连登勋章     ─┤                          └─→  IAP 商店购买
  极限成就     ─┤
  生日 / 周末  ─┘
                    [ 每日免费配额 ]
                    hintToken 3/d  undoToken 3/d
                    （ymd 日切自动复活，bomb/rainbow 无免费）
```

#### 数据流：皮肤切换 → 4 个并存订阅者
```text
setActiveSkinId(id)
   ├─ _skinTransitionHook(id, apply)        → skinTransition.js 0.6s 动画
   │                                          (拦截 apply 时机)
   └─ apply() {
        localStorage save
        applySkinToDocument(SKINS[id])
        _emitAfterApply(id) ─────────────────┐
      }                                      ▼
                                   ├─ ambientParticles.applySkin
                                   ├─ skinSoundPalettes.applySkin
                                   ├─ firstUnlockCelebration（首次才弹）
                                   └─ EffectLayer.setRenderer
```

### 9.4 P2 骨架的实施 TODO

> 以下 7 项作为骨架交付（API 占位 + 文档化 TODO），实际功能开发各需 ~3-8d 工时：

- **BGM 主题循环**（`bgmStub.js`）：需 36 款 30s OGG loop 音频资产
- **旋转方块**（`rotationStub.js`）：需 game.js dragBlock 流程改造 + hintEngine 重训
- **天气感知**（`seasonalSkin.weather.js`）：需 geolocation 权限请求 + open-meteo 调用
- **异步 PK**（`asyncPkStub.js`）：需 server.py 新表 + URL 路由 /pk/{id}
- **棋谱回放**（`replayAlbumStub.js`）：已记录 Top 10，真回放重现待 game.replayPlaybackLocked 流程
- **角色养成**（`companionStub.js`）：需 36 款 × 5 等级 = 180 张立绘资产
- **里程碑相册**（`replayAlbumStub.js` 同模块）：UI 待扩展（图鉴式 grid）

### 8.1 4 个道具的功能修复

#### 9.5.1 修复清单

| 模块 | Bug | 根因 | 修复 |
|------|-----|------|------|
| `undo.js` | **候选块消失**（用户报告） | `_normalizeDockState` 仅在 length 不一致时重建 DOM，落子后 `spawnBlocks` 已重建过 DOM，撤销时只替换 `dockBlocks` → DOM canvas 与 `dockBlocks` 不匹配 | 改用 `populateDockUI(descriptors, { logSpawn: false })` 完整重建 DOM（与 `applyReplayFrameIndex` 一致）|
| `undo.js` | snapshot 字段缺失 | `_cloneDock` 只保存 `id/shape/colorIdx/usedIcon`，缺 `placed/width/height` | descriptor 字段补齐 + 改用 `grid.toJSON/fromJSON` 替代 `grid.clone()`（更准确） |
| `undo.js` | 关卡模式禁用失效 | 字段名 `levelMode` 错误 → 实际为 `_levelMode === 'level'` 或 `_levelManager` | 修正字段名 + 加 `_levelManager` 检测 |
| `undo.js` | 调 `updateScoreUI()` 无效 | game.js 实际方法是 `updateUI()` | 改用 `updateUI()` |
| `undo.js` | 拖拽 / 预览状态残留 | 撤销后 `dragBlock` / `previewBlock` / `block-drag-active` body class 未清 | 还原时一并清掉 |
| `rainbow.js` | 染色后行未清除 | `checkLines` 只清已满行，染 5 格不会变满 | 改为「染主色 + 填空白」让行立即满 → 必触发 bonus 同色行清除 |
| `rainbow.js` | 极少非空行无意义消耗 | 整行只有 1-2 块也允许使用 | 加 `MIN_NON_EMPTY=3` 阈值，过少时不扣费提示换行 |
| `bomb.js` | 闪光误用 bonus | 用 `triggerBonusMatchFlash` 让玩家以为消行 | 改为 `triggerComboFlash(cells.length)` + 强震屏，区分常规消行 |
| `bomb.js` | 全空区域误扣费 | 旧版本扣费后再退还 | 改为先收集 cells，全空直接拒绝（无需退还路径）|
| `hint.js` | 长按检测过严 | 任何 `mousemove` 都取消长按，移动端用户手指微抖即取消 | 加 `MOVE_TOLERANCE_PX=8` 移动阈值，超过阈值才取消 |
| `hint.js` | mousedown 立即隐藏 | `document mousedown` 一律隐藏 hint，用户准备拖拽时 hint 就消失 | 改为只在 `block-drag-active` body class 添加时（拖拽真正启动）才隐藏 |
| `hint.js` | 无 hint 也扣费 | 旧版先 spend 再 computeHints，无可放位置时已扣费 | 改为先 computeHints，结果有可放位置才 spend |
| **共有** | 道具瞄准未互斥 | bomb / rainbow 都自管 `_aiming` | 新增 `web/src/skills/aimManager.js` 统一管理 + ESC 取消 |
| **共有** | 防御不足 | `isAnimating` / `isGameOver` / `replayPlaybackLocked` 时仍可触发 | 新增 `_isUsable()` 守卫 + 按钮 `enabled()` 同步置灰 |

#### 9.5.2 新增模块

| 文件 | 作用 |
|------|------|
| `web/src/skills/aimManager.js` | 单一来源管理 bomb / rainbow 瞄准互斥 + ESC 退出 + body class 同步 |

#### 9.5.3 新增测试（5 个文件 / 65 个用例 / 100% pass）

| 测试 | 用例数 | 覆盖重点 |
|------|--------|----------|
| `tests/wallet.test.js` | 15 | 默认状态、addBalance / spend、跨日免费配额重置（`vi.useFakeTimers`）、试穿券过期清理、`onChange` 事件 |
| `tests/skillsUndo.test.js` | 20 | 装饰 onEnd / start / endGame / spawnBlocks、snapshot 保存（落子前的 dock placed=false）、未落子不保存、关卡 / animating / gameOver / replayLock 禁用、余额 0 拒绝、**`populateDockUI` 必被调用以重建 DOM**、连续 undo 第二次拒绝、还原后清拖拽状态、start / endGame 失效 |
| `tests/skillsBomb.test.js` | 12 | 3×3 范围清除（保留空格）、加分 ×5、左上 / 右下边界裁剪、坐标越界拒绝、空区不扣费、余额不足拒绝、扣 1、isAnimating / isGameOver / replayLock 拒绝、用 `triggerComboFlash` 而非 bonus、setClearCells 带 color 字段 |
| `tests/skillsRainbow.test.js` | 10 | 染色 + 填空 → 必清除、bonus 同色行加分（160 分）、行 < 3 块拒绝、扣 1、余额 0 拒绝 + 不修改 grid、isAnimating / isGameOver / replayLock 拒绝、rowY 越界拒绝、setClearCells / triggerBonusMatchFlash / updateUI 调用 |
| `tests/skillsHintEconomy.test.js` | 8 | 计算成功才扣 1、grid 已满不扣费、余额 0 不触发、placed 块跳过、blockIdx 越界跳过、shape 缺失跳过、`_hintActive` 含 ttl、markDirty 调用 |

#### 9.5.4 验证结果

```
Test Files  34 passed (34)
Tests       532 passed (532)        ← 含新增 65 个
Lint        0 errors / 0 new warnings on web/src/skills/* + tests/skills*.test.js
```

> 注：tests/moveSequence.test.js 中 `Identifier 'describe' has already been declared` 是 pre-existing parsing error，与本次改动无关。

#### 8.1.5 4 个道具的最终行为契约

| 道具 | 触发 | 扣费时机 | 取消 |
|------|------|----------|------|
| **🎯 提示** | dock 块上长按 ≥ 380ms（容忍 8px 内微动） | computeHints 有结果才扣，无结果不扣 | 抬起 / 移动 > 8px / 拖拽启动（block-drag-active） / TTL 4.5s |
| **↩ 撤销** | 道具栏点击 | spend 成功才执行；失败回退（addBalance 退款）| 失败自动退款 |
| **💣 炸弹** | 点击按钮进入瞄准 → 棋盘点击 | 收集 3×3 内非空格，全空不扣费；非空确认后扣 1 | 棋盘外点击 / 再次点按钮 / ESC（aimManager） |
| **🌈 彩虹** | 点击按钮进入瞄准 → 棋盘点击 | 行内非空 < 3 不扣费提示；通过则扣 1 + 染整行 + 必清除 | 棋盘外点击 / 再次点按钮 / ESC（aimManager） |

bomb 和 rainbow 通过 `aimManager.enterAim(id)` 互斥（同时只能一个瞄准）；按 ESC 立即退出当前瞄准。

#### 8.2 道具 toast 视觉重构

> **问题**：用户在深色皮肤实测发现「已撤销最近一步」 toast 是白色胶囊覆盖在棋盘正中央，**遮挡盘面 + 与黑色盘面对比刺眼 + 文字与背景对比度不够**。原因是 `easter-egg-toast` 一个 id 同时承担了「道具操作反馈」（高频）和「Konami / 首解皮肤庆贺」（罕见）两种 UX 等级，统一用「中心大字」样式，对高频反馈过重。

**两级 toast 设计**：

| 等级 | 适用场景 | 样式 |
|------|----------|------|
| **normal**（默认，无需标记）| 道具操作反馈、扣费失败、瞄准提示、节日推荐等高频 toast | 底部玻璃条幅（`bottom: 110px`，dock 上方），半透明深色 + `backdrop-filter: blur`，14px 圆角，14px 字号，从下方上升入场，**不挡盘面、跨皮肤友好** |
| **celebrate**（显式 `el.dataset.tier = 'celebrate'`）| Konami / 首解皮肤 / 极限成就 / 连登勋章 / 赛季宝箱等罕见庆贺 | 中心 `top: 38%`，主题色光晕 + 强阴影，17px 字号 + 加粗 + 大字距，scale 入场 |

**实施**：

- **CSS 重构**（`web/public/styles/main.css`）：默认样式改造为底部玻璃条幅；新增 `[data-tier="celebrate"]` 选择器保留中心庆贺样式；`prefers-reduced-motion` 取消动画
- **道具文案补图标**：4 个 skills 模块的 `_showToast` 调用文案前缀图标（🎯 / ↩ / 💣 / 🌈 / ⚠），加强"道具感"
- **5 个庆贺场景显式标 celebrate**：`easterEggs.js`（Konami）/ `firstUnlockCelebration.js`（首解）/ `extremeAchievements.js`（成就）/ `loginStreak.js`（连登）/ `rewards/seasonChest.js`（赛季宝箱），每个加 2 行（`el.dataset.tier = 'celebrate'` + 隐藏时 `delete el.dataset.tier`）
- **零侵入**：保持 `easter-egg-toast` id 与 `_showToast(msg)` 接口不变，未改 13 个调用方的函数签名

#### 8.3 皮肤剧情图鉴海报卡重构

> **问题**：用户实测皮肤图鉴弹窗（点 📖 按钮唤起）发现 4 个视觉问题：① 卡片背景与盘面融为一体，弹窗存在感弱；② 描述正文 14px 且平淡，缺乏艺术化呈现；③ 上一款 / 下一款用纯文字胶囊按钮，无方向感；④ "使用此皮肤"白底黑字按钮与深色卡片冲突。

**根因**：
- `.lore-card { background: ${skin.cssBg} }` 直接使用皮肤的盘面背景色 → 在深色皮肤下卡片与盘面同色，视觉上"沉入"游戏背景
- 整个图鉴卡片只有简单矩形 + 白色按钮，没有设计语言"统领"

**重构（5 项）**：

| 元素 | 旧版 | 新版 |
|------|----------|----------|
| 卡片背景 | `style="background:${skin.cssBg}"` 直接用盘面色 | 统一深色玻璃 + **主题色 hero 顶条**（径向 + 线性渐变光斑），跨皮肤一致质感；通过 inline `--accent-color` 让每款皮肤的图鉴卡有独特调性 |
| 边框 / 阴影 | `box-shadow: 0 22px 48px` 仅外阴影 | 加 `0 0 0 1px var(--accent-color) inset` 主题色细边光晕 + 外发散 `0 0 48px var(--accent-color) 18%`，与盘面强对比 |
| 正文排版 | 14px / line-height 1.7 / 普通字重 | **17px / italic / line-height 1.85 / `border-left: 3px var(--accent-color)`** 引用线 — 有"札记"质感 |
| 翻页按钮 | "上一款" / "下一款" 文字胶囊 | **‹ / › 圆形 44×44 箭头按钮**（hover 时主题色填充 + translateY -1px） |
| 主按钮 | 白底黑字胶囊 `background: rgba(255,255,255,0.92)` | **主题色渐变填充**（`linear-gradient(135deg, var(--accent-color), color-mix(...))`）+ ✦ 图标 + 大字距，贴卡片底部圆角；当前激活皮肤改为「✓ 当前使用中」灰色禁用态 |

**新增交互**：
- 键盘 ← / → 翻页，Esc 关闭
- 表情 icons 行（lore-icon-row）改为深色玻璃 chip 容器，与正文区域对比更清晰
- 卡片入场 `transform: translateY(8px) → 0` 配合 opacity，比纯渐显更有"翻开"质感

**改动**：

- `web/public/styles/main.css`：`.lore-card` 系列 ~140 行重写
- `web/src/lore/skinLore.js`：HTML 模板调整 + `_installKeyboardNav` + 字符串 escape + 当前激活态切换 + 不再 inline `skin.cssBg`

#### 8.4 图鉴卡古诗集卷轴风格

> **问题**：① 整体灰蓝调单一，缺艺术感；② 描述文字虽改为 italic 但仍是西式段落；③ 主按钮独占一行显得"工具感"，希望紧凑同行。

**根因**：
- 主题色字段 99% 皮肤定义在 `cssVars['--accent-color']` 而非 `skin.accent`，fallback 链 `skin.accent || skin.gridLine` 几乎都落到 `gridLine`（深灰），所以 lava 这种橙红色皮肤的卡片渲染成灰蓝
- 西式 italic 段落 + `border-left` 引用线对中文古典皮肤（古风 / 国潮）适配差

**重构 5 项**：

| 元素 | 旧版 | 新版 |
|------|----------|----------|
| 主题色 fallback | `skin.accent \|\| skin.gridLine \|\| '#38bdf8'` | **`skin.cssVars['--accent-color']`** 优先（lava → 熔岩橙 / sunset → 暮色橙 / aurora → 极光紫等真正生效） |
| 章节标识 | `lore-icon-row` 8 个 emoji 占一整行 | 替换为 **诗签分割线** `——卷 7 / 36——`：两侧主题色渐变细线 + 中间衬线小字（带主题色阴影） |
| 正文排版 | 17px italic + `border-left` 引用线 + 左对齐 | **古诗集卷轴排版**：衬线字体（楷体 / 宋体）+ 19px / line-height 2.0 / letter-spacing 0.10em + 居中 + **短句独立成行**（按 `——，；。：` 拆分），`——` 单独一行作停顿（主题色 + 发光） |
| 操作行 | `[‹ 7/36 ›]` + 单独一排「使用此皮肤」按钮 | **`[‹] [✦使用此皮肤] [›]` 同行**（flex: 0 0 44 / 1 1 auto / 0 0 44），节省 60+ px 垂直空间 |
| 主按钮 | 大圆角矩形 padding 14 + 字距 0.10em | 圆胶囊（border-radius: 999）+ 字距 0.16em + 主题色光晕 box-shadow（`0 8px 22px var(--accent-color) 30%`），与左右翻页按钮在视觉上「一组」 |

**核心实现 — 古诗式正文渲染**：

```javascript
// web/src/lore/skinLore.js
function _formatPoem(story) {
    const tokens = story.split(/(——)/g);   // 保留 ——
    const html = [];
    for (const t of tokens) {
        if (t === '——') {
            html.push('<span class="lore-poem-pause">——</span>');
            continue;
        }
        // 按 ，；。： 拆分，标点保留在行末
        const subParts = t.split(/(?<=[，；。：])/);
        for (const p of subParts) {
            if (p.trim()) {
                html.push(`<span class="lore-poem-line">${_escape(p.trim())}</span>`);
            }
        }
    }
    return html.join('');
}
```

例（lava）：
```
火山口边缘的炽热       ← lore-poem-line
   ——                  ← lore-poem-pause（主题色 + 发光）
岩浆在脚下流淌，       ← lore-poem-line（标点保留）
方块是凝固的玄武岩，
消行是新一次喷涌。
```

**改动**：
- `web/src/lore/skinLore.js`：新增 `_formatPoem()` + 修正 accent fallback 链 + 模板调整
- `web/public/styles/main.css`：新增 `.lore-poem-line` / `.lore-poem-pause` / `.lore-card__divider` / `.lore-divider-mark`，footer 改为 flex 同行布局

#### 8.5 图鉴卡背景水印 + 文案修正

> **3 项请求**：① 把皮肤典型 icons 也放置到图鉴卡中；② 设置与主题相关的背景图（参考盘面背景）；③「卷 1/36」表述不准确，改为「主题 1 / 36」。

**实施**：

1. **复用盘面 `boardWatermark.icons` 作图鉴卡背景**：所有 36 款皮肤都已在 `skins.js` 定义了 `boardWatermark: { icons, opacity }`（如 lava 是 `['🌋', '🔥']`、aurora 是 `['🐧', '🐻‍❄️', '❄️', '🌌']` 等），盘面已用此渲染水印 — 图鉴卡直接复用，**视觉与游戏盘面一致呼应**

2. **6 个 watermark 位置预设**（`WATERMARK_PRESETS` 常量），icons 不足 6 个时循环复用：

```javascript
// web/src/lore/skinLore.js
const WATERMARK_PRESETS = [
    { top: '6%',  left: '4%',   rotate: -15, size: 52 },   // 左上
    { top: '8%',  right: '6%',  rotate: 18,  size: 58 },   // 右上
    { top: '38%', left: '-3%',  rotate: -8,  size: 96 },   // 左中（部分超出 + 96px 大字）
    { top: '42%', right: '-5%', rotate: 12,  size: 90 },   // 右中
    { top: '70%', left: '6%',   rotate: 14,  size: 50 },   // 左下
    { top: '72%', right: '8%',  rotate: -10, size: 60 },   // 右下
];
```

中央留空保证正文居中可读；中部两个图标 size 大但 opacity 低，营造"质感"；超出卡片边缘的部分被 `overflow: hidden` 剪裁，形成"边缘半截图标"的纸质纹理。

3. **opacity 联动盘面**：`opacity = min(0.18, boardWatermark.opacity * 1.6)` — 卡片背景比盘面更深，需要略提亮才能看到水印

4. **z-index 分层**：watermark `z-index: 0` → hero 顶条（`::before`）`z-index: 1` → 内容（head / divider / body / foot）`z-index: 2`，确保点击和文字始终在最上层

5. **CSS mask 软化**：watermark 容器顶部 18% 与底部 22% 用 `mask-image` 渐变蒙版淡出，避免与 hero 顶条 / footer 区域硬叠加

6. **文案修正**：「卷 7 / 36」→「主题 7 / 36」（卷的隐喻容易让人理解为剧情章节而非皮肤序号）

**改动**：
- `web/src/lore/skinLore.js`：新增 `_renderWatermark(skin)` + `WATERMARK_PRESETS` 常量；HTML 模板加 `<div class="lore-bg-watermark">`；divider 文案 卷 → 主题
- `web/public/styles/main.css`：新增 `.lore-bg-watermark` 容器（含 mask 渐变蒙版）+ 子元素 emoji 样式；为 head / divider / body / foot 统一设 `position: relative; z-index: 2`；为 `.lore-card::before` 设 `z-index: 1`

视觉效果（lava 举例）：
- 卡片左上、右上、左下、右下散落 4 个 🌋 / 🔥 emoji（约 50-60px）
- 卡片左中、右中各有一个 90-96px 大 emoji，部分溢出卡片边缘被剪裁
- 全体 opacity ~ 0.11，视觉柔和但能看出"主题元素"
- hero 顶条主题色光斑覆盖 watermark 顶部 → 顶部 watermark 自然变暗
- footer 区域 watermark 也变暗，确保翻页 / 主按钮读屏清晰

---

---

### 8.10 图鉴 icon 阵列 + 高度稳定 + hint 改瞄准模式

### 一、图鉴卡新增「主题 icon 阵列」（divider 与正文之间）

用户反馈："1) 将主题的icon列表显示出来"。固定 24px icon 行去掉换成隐式 watermark 后，对方块图标的视觉传达减弱（用户不再能直接确认该皮肤涵盖哪 8 种 colorIdx 的具体 emoji）。

修复策略 — **保留水印 + 显式 chip 阵列双重露出**：

1. **新增 `.lore-card__icons` 区**：在 `lore-card__divider`（"主题 N/36" 章节标）之下、`.lore-card__body`（古诗正文）之上插入；取 `skin.blockIcons.slice(0, 8)`，对应游戏 8 种 colorIdx 的全部 icon
2. **chip 视觉**：每个 emoji 包裹于 38×38 圆角玻璃 chip，半透明背景 + 主题色 22% border + 内嵌 highlight；hover 时 `translateY(-2px)` 并提亮 border
3. **降权于水印**：chip 的 22px 字号 < watermark 的 50-96px，避免视觉抢占；显式 chip 给出"图鉴说明"，水印给出"诗签纹理"，二者职能互补

```html
<div class="lore-card__divider">主题 7 / 36</div>
<div class="lore-card__icons">
  <span>🌋</span><span>🔥</span><span>🌶️</span>... (×8)
</div>
<div class="lore-card__body"><p class="lore-story">...</p></div>
```

### 二、图鉴卡 body 区域固定高度 — 翻页按钮位置稳定

用户反馈："2) 浮层大小随切换主题而变化，导致翻页按钮位置不固定，影响操作连续性"。

根因：不同皮肤的 `story` 字数差异大（70~130 字 / 4~6 个短句），加上 `_formatPoem` 按句切分独立成行，正文行数 4-7 行不等，传导到外层卡片整体高度浮动 ~80px，每次翻页 `‹` `›` 按钮纵向跳动。

修复 — **body 固定 min-height + flex 垂直居中**：

```css
.lore-card__body {
    padding: 14px 28px 22px;
    min-height: 248px;        /* 6 行 × line-height(2.0 × 19px ≈ 38px) ≈ 230px + padding */
    display: flex;
    align-items: center;       /* 短故事不会贴顶，长故事自然向两端撑开 */
    justify-content: center;
}
.lore-story { width: 100%; }   /* 让正文占满 flex 容器宽度 */
```

效果：
- 4 行短故事（如 desert / forbidden）→ 正文垂直居中
- 7 行长故事（如 boardgame / neonCity）→ 正文充满 body 区域
- 卡片高度恒定，翻页按钮在 footer 中位置不再跳动

### 三、hint 道具改为「按钮 → 选块」瞄准模式（去掉长按自动扣费）

用户反馈："3) 作为道具，长按候选后自动触发道具使用，不太合理，优化触发道具使用逻辑"。

#### 旧实现

dock 块上长按 ≥ 380ms（带 8px 容忍）→ 自动扣 1 hintToken + 显示推荐位置。问题：
1. 与其他三件道具（bomb / rainbow / undo）的「按按钮 → 选目标」流程不一致，玩家学习成本高
2. 长按容易被误触（手指停留稍久即扣费）
3. 长按交互无视觉前置反馈（按下时不知道松手会扣费）

#### 新实现 — 与 bomb / rainbow 完全统一

```
点击 🎯 按钮 → enterAim('hint-quick')           ← aimManager 互斥 + ESC 取消
            → toast「点击候选区任意一块查看最佳落点」
            → dock 块出现脉动光晕（CSS 动画）
点击候选块 → capture 阶段截获 pointerdown / mousedown / touchstart
         → 阻止默认拖拽行为（preventDefault + stopPropagation + stopImmediatePropagation）
         → computeHints → 扣 1 hintToken → 显示 fxCanvas 高亮（4.5s TTL）
         → exitAim 自动退出瞄准
```

> v10.16.7 修复：`game.js` 候选块在支持 `PointerEvent` 的浏览器/触屏上用 `pointerdown` 启动拖拽，hint 监听器必须同时拦截 `pointerdown`，否则瞄准状态下点击候选块会先触发拖拽并立刻把 `_hintActive` 清掉，外观上表现为"点击没反应"。

**关键代码**：

```javascript
// hintEconomy.js
function _installAimListener() {
    const dock = document.getElementById('dock');
    const handler = (e) => {
        if (!isAiming(SKILL_ID)) return;       // 非瞄准状态 → 让原拖拽流程接管
        const blockEl = e.target.closest('.dock-block');
        if (!blockEl) return;
        const idx = parseInt(blockEl.dataset.index, 10);
        if (Number.isNaN(idx)) return;
        e.preventDefault();
        e.stopPropagation();                    // 防止 game.js 的 startDrag 启动
        e.stopImmediatePropagation?.();
        _triggerHint(idx);
        exitAim(SKILL_ID);
    };
    dock.addEventListener('pointerdown', handler, { capture: true });
    dock.addEventListener('mousedown', handler, { capture: true });
    dock.addEventListener('touchstart', handler, { capture: true, passive: false });
}
```

**配套 CSS** — dock 区域瞄准态视觉提示：

```css
.skill-aim-hint-quick #dock .dock-block:not(.placed) {
    cursor: pointer;
    animation: hint-aim-pulse 1.4s ease-in-out infinite;
}
.skill-aim-hint-quick #dock {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, #FFD160 70%, transparent);
    border-radius: 12px;
}
@keyframes hint-aim-pulse {
    0%, 100% { filter: drop-shadow(0 0 0 rgba(255, 209, 96, 0.0)); transform: translateY(0); }
    50%      { filter: drop-shadow(0 0 8px rgba(255, 209, 96, 0.85)); transform: translateY(-2px); }
}
```

#### 删除的代码

- `_installLongPressListener` 整体移除
- `LONG_PRESS_MS`、`MOVE_TOLERANCE_PX` 常量移除
- 长按 mousedown / touchstart / move / up / cancel 的 5 类事件回调移除
- `MutationObserver` 仅保留用于「拖拽真正启动时清除 hint 高亮」的少量逻辑（不再用于隐藏长按 timer）

#### v10.16.7 渲染回归修复（高亮在常规皮肤上不显示）

**症状**：瞄准模式下点击候选块后「没有显示提示，候选区失焦」。

**根因**：hint 高亮通过 hook `renderer.renderAmbient` 画在 fxCanvas 上。但 v1.55.12 的 GPU 优化会在 `render()` 末尾调用 `syncFxCanvasVisibility()` → `_hasFxContent()`；该判定**不认识 hint 高亮**，在没有环境粒子的 30+ 常规皮肤上返回 `false`，于是 fxCanvas 被 `display:none` 下沉合成层——高亮画了却看不见。同时单次 `markDirty` 后盘面静止，脉动动画不跑、TTL 不再被检查。`exitAim` 移除候选区脉动光晕即用户感知的「失焦」。

**修复**：
- `renderer._hasFxContent()` 增加 `if (this._externalFxActive) return true;`，让外挂渲染钩子可声明「fxCanvas 有内容」。
- `hintEconomy` 在高亮激活期间：① 置 `renderer._externalFxActive = true` 保持 fxCanvas 可见；② 自驱动一个 rAF 循环每帧 `markDirty`，维持脉动动画并检查 4.5s TTL；③ 过期 / 拖拽开始时统一经 `_hideHint()` 收口（取消 rAF + 复位标志 + 末帧清除）。
- `_drawHintOverlay` 不再在 render 过程中改状态，TTL 收口到循环。

#### 测试新增（4 例）

`tests/skillsHintEconomy.test.js`（→ 12 例）：
- ✅ initHintEconomy 注册 capture 监听 — 非瞄准状态下点击 dock 块不扣费
- ✅ 进入瞄准 → 点击 dock 块 → 扣费 + 设置 _hintActive + 自动退出瞄准
- ✅ 瞄准状态下点击 dock 间隔区（非 .dock-block）→ 不扣费 + 仍处于瞄准（让用户重选）
- ✅ 未进入瞄准时点击 dock 块 → 走原拖拽流程（事件未被 hint 截获）

### 改动清单

| 文件 | 改动 |
|---|---|
| `web/src/lore/skinLore.js` | 新增 `iconRow` HTML 片段（divider 之后插入 `.lore-card__icons` × 8 chip） |
| `web/src/skills/hintEconomy.js` | 重写：去掉长按，改 `_installAimListener` capture 截获 dock mousedown/touchstart；按钮 onClick 改 `_toggleAim`；保留所有 `__*ForTest` 导出 |
| `web/public/styles/main.css` | `.lore-card__icons` 样式；`.lore-card__body` min-height + flex；`.skill-aim-hint-quick` 选择器 + `@keyframes hint-aim-pulse` |
| `tests/skillsHintEconomy.test.js` | 新增 4 例瞄准模式测试，import `aimManager` |

### 验收

- ✅ Vitest 536/536 通过（旧 532 + 4 新增）
- ✅ ESLint 改动文件 0 errors / 0 warnings
- ✅ 体感：4 个道具触发流程完全统一（按按钮 → 视觉提示 → 选目标 → 自动退出）
- ✅ 翻页 ‹ › 按钮位置在不同皮肤间稳定（卡片高度恒定）
- ✅ 主题 icon 阵列与水印共存：chip 给"说明"，水印给"纹理"

---

### 8.11 成就 toast 艺术化 + 同 icon 爆炸减量

> 用户反馈：
> 1）"用户成就达成样式太朴实，采用冲击力更强、图案化、艺术化的样式"
> 2）"同 icon 消除时，爆炸飞出的 icon 数量过多，适度减少数量"

### 背景与定位

| 反馈点 | 影响范围 | 改造方式 |
|---|---|---|
| 成就样式朴实 | 12+ 庆贺触发点共用 `#easter-egg-toast[data-tier="celebrate"]` | **CSS-only 重写**（不改 12 个调用方 JS） |
| 同 icon 爆炸过密 | `renderer.js` 的 `beginBonusIconGush` / `_tickIconGushSpawn` / `addIconParticles` | 三档调参，emoji 粒子降量 ~40%，色块粒子保留 |

**触发该样式的 12 个庆贺点**：Konami 彩蛋 / 首解皮肤 / 极限成就 / 段位升级 / 月度里程碑 / wow moments / 皮肤碎片解锁 / 复盘里程碑 / 每日特餐 / 首胜加分 / 季节宝箱 / 连登勋章。

### 9.5.11.A celebrate toast 艺术化（CSS-only）

**升级前**：单层深色背景 + 1px 主题色 inset 边框 + scale(0.86→1) 入场，"中心大字 + 微弱光晕"，所有皮肤统一表现。

**升级**：

| 元素 | 升级前 | 升级后 |
|---|---|---|
| 入场动画 | scale 0.86→1 线性 | scale 0.78→1 + rotate(-1°→0°)，弹性曲线 `cubic-bezier(0.18,0.89,0.32,1.4)` |
| 背景 | 单色 `rgba(18,18,28,.92)` | 三层叠加：中心暖光斑径向渐变 + 底部主题色微晕 + 玻璃底色，加 `backdrop-filter: blur(14px) saturate(160%)` |
| 边框 | 1px 主题色 inset | 4 层 box-shadow：黑描边间隔（4px）→ 主题色金边（5px）→ 阴影沉降 → 110px 整体光晕扩散 |
| 光线放射 | 无 | `::before` 12 道 conic-gradient 金色光线呈圆周分布，10s 缓慢自转，is-visible 时淡入到 0.85 透明 |
| icon 字 | 30px 静态 | **56px** + 心跳动画 `scale(1→1.10) + rotate(-4°→4°)` 1.4s 循环 + 22px `drop-shadow` 主题色光晕 |
| 标题字 | 17px 等距 | **24px 衬线（STKaiti / KaiTi）** + `background-clip: text` 三段渐变金字（白→主题色→深金）+ 闪烁动画（光晕 6→16px 呼吸） |
| 描述字 | 默认 | 13px 浅色 + 字距 0.06em + 阴影 |
| textContent 兜底 | 无 | celebrate 整体 `font-size: 22px / font-weight: 800 / 衬线`（让 firstUnlockCelebration 等无 inner div 的模块也艺术化） |
| 无障碍 | 仅 `transition: none` | 同时关闭 `::before` 旋转 / icon 心跳 / 标题闪烁三类无限循环动画 |

#### CSS 关键片段

```css
/* 旋转金色光线放射 — 12 道沿圆周分布 */
#easter-egg-toast[data-tier="celebrate"]::before {
    content: '';
    position: absolute;
    inset: -45%;
    z-index: -2;
    border-radius: 50%;
    background: conic-gradient(
        from 0deg,
        transparent 0deg,
        color-mix(in srgb, var(--accent-color, #fbbf24) 28%, transparent) 5deg,
        transparent 12deg,
        /* ... 共 12 道光线，每 30° 一组 ... */
    );
    animation: celebrate-rays 10s linear infinite;
    opacity: 0;
    filter: blur(3px);
    transition: opacity 0.6s ease;
}
#easter-egg-toast[data-tier="celebrate"].is-visible::before {
    opacity: 0.85;
}

/* 标题字渐变金 + 光晕呼吸 */
#easter-egg-toast[data-tier="celebrate"] > div:nth-child(2) {
    font-family: 'STKaiti', 'KaiTi', 'Songti SC', 'STSong', serif !important;
    font-size: 24px !important;
    font-weight: 800 !important;
    letter-spacing: 0.16em !important;
    background: linear-gradient(180deg,
        #fff 0%,
        color-mix(in srgb, var(--accent-color, #fbbf24) 40%, #fff) 35%,
        var(--accent-color, #fbbf24) 65%,
        color-mix(in srgb, var(--accent-color, #fbbf24) 80%, #92400e) 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 0 10px color-mix(in srgb, var(--accent-color, #fbbf24) 65%, transparent))
            drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7));
    animation: celebrate-title-shimmer 2.4s ease-in-out infinite alternate;
}

/* icon 字心跳脉动 + 摇摆 */
#easter-egg-toast[data-tier="celebrate"] > div:nth-child(1) {
    font-size: 56px !important;
    line-height: 1 !important;
    margin: 0 0 12px !important;
    animation: celebrate-icon-pulse 1.4s ease-in-out infinite alternate;
    filter: drop-shadow(0 0 22px color-mix(in srgb, var(--accent-color, #fbbf24) 75%, transparent))
            drop-shadow(0 4px 8px rgba(0, 0, 0, 0.55));
}
@keyframes celebrate-icon-pulse {
    from { transform: scale(1) rotate(-4deg); }
    to   { transform: scale(1.10) rotate(4deg); }
}
```

#### 选择器策略

12 个调用方都遵循"icon-title-body"3-div 模板（`firstWinBoost` 是 2-div、`monthlyMilestone` 含 unlockedSkin 时也是 3-div），所以用 `> div:nth-child(N)` 精准命中各部分；纯 `textContent` 模式（`firstUnlockCelebration` / `extremeAchievements` / `easterEggs`）则继承 celebrate 整体 22px 衬线兜底字号。**12 个 JS 调用方零改动**。

#### 移动端适配

```css
@media (max-width: 480px) {
    #easter-egg-toast[data-tier="celebrate"] { padding: 22px 36px 18px; min-width: 240px; }
    #easter-egg-toast[data-tier="celebrate"] > div:nth-child(1) { font-size: 44px !important; }
    #easter-egg-toast[data-tier="celebrate"] > div:nth-child(2) { font-size: 20px !important; letter-spacing: 0.12em !important; }
    #easter-egg-toast[data-tier="celebrate"]::before { inset: -30%; }
}
```

### 9.5.11.B 同 icon 爆炸粒子减量（renderer.js）

**问题**：`beginBonusIconGush` 首帧产生 60 个 emoji 粒子 + `_tickIconGushSpawn` 持续涌出 cap 560，导致 emoji 飞满屏，遮挡盘面 + 与色块粒子叠加视觉过重。

**调整**：emoji 粒子整体降 40%，色块粒子（`addBonusLineBurst` 144 个）保留。

| 函数 | 旧值 | 新值 | 降幅 |
|---|---|---|---|
| `beginBonusIconGush` 首帧 emoji 爆炸 | 60 | **36** | -40% |
| `_tickIconGushSpawn` 在屏 emoji cap | 560 | **320** | -43% |
| `_tickIconGushSpawn` 早期 rolls | 86%概率 3 个 / 14% 2 个 | 70%概率 2 个 / 30% 1 个 | -40% |
| `_tickIconGushSpawn` 中期 rolls | 62%概率 2 个 / 38% 1 个 | 55%概率 1 个 / 45% 0 个 | -55% |
| `_tickIconGushSpawn` 末期 rolls | 42%概率 1 个 | 30%概率 1 个 | -28% |
| `addIconParticles` 默认 count | 40 | **24** | -40% |

#### 取舍说明

- **保留色块爆炸（`addBonusLineBurst` 144 个）**：72 主粒子 + 36 高速碎屑 + 36 金色火花仍提供"满屏火花"基础冲击力
- **emoji 粒子定位为"主题彩头"而非"主体特效"**：原 60 + 持续涌出 cap 560 让 emoji 喧宾夺主，36 + cap 320 仍能营造"飞翔感"但不挡盘面
- **小程序端无该代码**：`miniprogram/utils/renderer.js` 不实现 `beginBonusIconGush`，本次仅 web 端调整

### 改动清单

| 文件 | 改动 |
|---|---|
| `web/public/styles/main.css` | 重写 `#easter-egg-toast[data-tier="celebrate"]`（约 +130 行）：旋转光线 + 双边框 + 渐变金字 + 心跳 icon + 衬线字体 + 移动端适配 + reduced-motion 三类动画关闭 |
| `web/src/renderer.js` | `beginBonusIconGush` 60→36 / `_tickIconGushSpawn` cap 560→320 + rolls 三档下调 / `addIconParticles` 默认 24 |

### 验收

- ✅ Vitest 557/557 全过（无新增测试 — 视觉调整）
- ✅ ESLint 0 errors / 0 warnings（renderer.js 改动文件）
- ✅ 12 个庆贺触发点统一升级（无需逐个修改 JS）
- ✅ 同 icon 爆炸视觉密度从"满屏 emoji 雪花"→"清爽冲击 + 持续余韵"
- ✅ 无障碍：`prefers-reduced-motion` 用户禁用所有循环动画

---

### 8.12 玩家落子后点赞策略收紧

> 用户反馈："分析玩家方块后的点赞策略，当前存在方块后死局仍然点赞的不当策略。只有在复杂盘面情况下，且玩家放置为妙局的情况才给点赞表情。"

### 背景与问题

落子后的 👍 反馈由 `game.js` 的 `_checkToughPlacement` 触发，定位是「玩家在困难盘面中找到不消行但仍有价值的落点」时给一个轻量情绪奖励。旧策略只看放置前盘面与当前形状：

- 方块占格数 ≥ 3
- 放置前占用率 `fillBefore >= 0.50`
- 当前形状合法落点数 `validsBefore <= 3`

问题在于：旧策略没有校验**本手之后 dock 中其它未落块是否还有可走步**。因此玩家若把局面走成无步可走，仍可能因为「当前形状本来合法位很少」而弹 👍，形成"走进死局也被夸"的错误反馈。

### 新行为契约

点赞只在**非消行落子**后评估；消行已经有清行动画、连击、得分等反馈，不再叠加 👍。

| 条件 | 阈值 / 规则 | 说明 |
|---|---|---|
| 块复杂度 | `blockCells >= 3` | 排除 1 格、2 格的低成本摆放 |
| 盘面复杂度 | `fillBefore >= 0.55` | 必须是中高填充盘面，不奖励普通局面 |
| 当前形状稀缺度 | `validsBefore <= 3` | 当前块在放置前全棋盘可落点很少 |
| 妙局判定 | `validsBefore <= 2` 或 `fillBefore >= 0.68 && validsBefore <= 3` | 常规复杂局面要求 ≤2 个落点；极高填充下允许 3 选 1 的窄位抉择 |
| 死局排除 | 若还有其它未落块，必须 `grid.hasAnyMove(others)` | 本手后其它 dock 块至少还能落下一枚，否则不点赞 |
| 本轮最后一块 | `others.length === 0` 时不按死局过滤 | 最后一块之后即将刷新 dock，由 `spawnBlocks()` 承接 |

### 设计原则

- **赞妙手，不赞幸存**：只在复杂盘面 + 窄位选择中点赞，避免把普通低风险落子包装成高光。
- **赞延续，不赞自杀**：落子后如果其它未落块已无路可走，不论本手放置前多困难，都不弹 👍。
- **轻反馈优先级低于核心反馈**：消行、连击、通关、结算等已有强反馈场景不叠加点赞，避免 UI 噪音。
- **避免误伤轮末刷新**：本轮最后一块落下后候选区即将刷新，不把 `others.length === 0` 解释为死局。

### 验收

- ✅ 在高填充、当前块仅 1-2 个合法落点、落子后其它未落块仍可落下时弹 👍
- ✅ 在落子后导致其它未落块全部无可落点时不弹 👍，后续正常进入无步可走结算
- ✅ 普通盘面（`fillBefore < 0.55`）不弹 👍
- ✅ 当前块合法落点多于 3 个不弹 👍
- ✅ 本轮最后一块的非消行妙手不因 `others.length === 0` 被误判为死局

---

### 9.6 验收 checklist

- [ ] 进入游戏 → 弹 7 日签到（首次进入）
- [ ] 签到第 7 天 → 自动获得 24h 限定皮肤试穿券
- [ ] 道具栏新增 4 个按钮：🎯 提示 / ↩ 撤销 / 💣 炸弹 / 🌈 彩虹
- [ ] 点击 🎯 → 进入瞄准模式 → 点击 dock 候选块 → 高亮该块最佳落点
- [ ] 点击 ↩ → 还原最近一步（消耗 1 undoToken）
- [ ] 点击 💣 进入瞄准模式 → 棋盘点击清除 3×3（ESC / 棋盘外点击取消）
- [ ] 点击 🌈 进入瞄准模式 → 棋盘点击该行 → 行内非空 ≥ 3 时染主色 + 填空 → bonus 同色行清除（ESC 取消）
- [ ] 同时只能有一个道具处于瞄准状态（bomb 与 rainbow 互斥）
- [ ] 撤销后候选区方块不消失、形状颜色与撤销前一致
- [ ] 4 件道具触发流程一致（按按钮 → 视觉提示 → 选目标 / 立即生效）
- [ ] 局末（5% 概率 / 12 局保底）→ 弹宝箱
- [ ] 周一 / 周五首次进入 → 顶部条幅提示「今日免费转盘」
- [ ] 累积 1000 XP → 弹普通赛季宝箱
- [ ] 触发 `game.cheat.skin('forbidden')` → 首次激活该皮肤时 perfect flash + 飘字
- [ ] 单局得分 ≥ 5000 → 弹「荣誉」成就 toast
- [ ] 切到 music 皮肤 → 消行音变钢琴音
- [ ] 12.25 时进入游戏 → 盘面边框出现绿/红流动彩带
- [ ] 主菜单新增「🏅 每日大师题」按钮 → 启动同种子局
- [ ] 皮肤选择面板旁新增 📖 按钮 → 打开剧情图鉴
- [ ] 控制台 `__wallet.getBalance('hintToken')` 返回数值
- [ ] 控制台 `__bgm.isImplemented()` 返回 false（骨架占位）
- [ ] `npm test` 全过 + `npm run lint` 0 新错
- [ ] 触发任意 celebrate（如 `__wowMoments.fire('first-perfect')`）→ 中央卡片入场带摇摆 + icon 心跳 + 标题金色渐变 + 12 道光线缓慢自转
- [ ] 同 icon 整行清除 → emoji 粒子飞翔感保留但不再"满屏雪花"，色块爆炸不变
- [ ] 复杂盘面妙手非消行且不会造成死局 → 弹 👍；落子后死局 → 不弹 👍

