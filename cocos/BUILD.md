# 构建与导出指南

前置：Cocos Creator **3.8.x**，已能在编辑器内预览运行（见 `README.md`）。

## 0. 打包前校验（建议每次出包前在仓库根执行）

```bash
npm run verify:cocos-core   # 校验 shapesData / engine 与 web 同源（drift 守门）
npm run typecheck:cocos      # 全相位 strict 类型检查（含 P0-P2 新代码，使用 cocos/typecheck/cc.d.ts 离线 cc 桩）
```

> `cocos/tsconfig.verify.json` + `cocos/typecheck/cc.d.ts` 仅用于命令行/CI 离线类型校验，
> 不参与 Creator 构建（编辑器使用引擎自带 `cc` 类型）。

## 1. Web（H5）

- 菜单 `项目 → 构建发布`，平台选 `Web Mobile` 或 `Web Desktop`，点「构建」。
- 产物在 `build/web-mobile/`，可直接部署到任意静态服务器。
- 程序化音效 / BGM（WebAudio）在浏览器首个触摸后自动解锁，无需音频文件。

## 2. 微信小游戏

1. 构建平台选 `微信小游戏`，填 AppID，构建 → 产物 `build/wechatgame/`。
2. **接广告/内购（配置驱动，无需改 Bootstrap）**：把激励视频广告位 id 填到远程配置即可，
   `Bootstrap.detectPlatform()` 检测到微信环境且存在非空 adUnitId 时会自动
   `registerWechat(adUnitIds)` 启用。两种填法任选其一：

   ```ts
   // a) 静态默认：编辑 core/remoteConfig.ts → DEFAULT_CONFIG.adUnitIds
   adUnitIds: { revive: 'adunit-xxx', doubleChest: 'adunit-yyy', wheel: 'adunit-zzz', reroll: 'adunit-www' }

   // b) 运行时下发（推荐，便于不发版调整）：
   import { applyRemote } from './core';
   applyRemote({ config: { adUnitIds: { revive: 'adunit-xxx', /* ... */ } } });
   ```

3. 业务里已通过 `platform/Ads` 调用，无需手写 SDK：
   - 复活 / 翻倍 / 转盘 / reroll：`const ok = await Ads.rewarded('revive');`（placement 见 `adUnitIds` 键）
   - 内购：`const ok = await Ads.purchase('coins_60');`（商品见 `remoteConfig.iapProducts`）
4. 排行榜（可选）：接微信开放数据子域绘制；`platform/Leaderboard.submit()` 已写
   `wx.setUserCloudStorage`，并有本地 Top 榜兜底。
5. 云存档（可选）：`platform/CloudSync` 已写 `wx.setUserCloudStorage` + 离线队列 + 拉取合并（取 best 较大者）。
6. 埋点（可选）：`platform/AnalyticsSink` 默认走 `wx.reportEvent`；事件口径见 `core/analytics`（与 web GAME_EVENTS 对齐）。
7. 用**微信开发者工具**打开 `build/wechatgame/` 预览、上传审核。
- 震动走 `wx.vibrateShort/Long`，存档走 `wx.localStorage`（`sys.localStorage` 已封装）。
- 语言自动探测 `wx.getSystemInfoSync().language`（`core/i18n`，内置 zh-CN / en）。

## 3. iOS / Android（原生）

1. 构建平台选 `iOS` / `Android`，生成原生工程（Xcode / Android Studio）。
2. 实现并注入原生广告/支付适配（JSB 桥接 AdMob / StoreKit / Google Billing）：

   ```ts
   class NativeAds implements AdsAdapter { /* 调 native.bridge / JSB */ }
   Monetization.useAds(new NativeAds());
   Monetization.useIap(new NativeIap());
   ```

3. 在原生工程接入对应 SDK 依赖后编译出包。

**Android 环境（与 Capacitor 壳共用）**

```bash
npm run setup:android              # 检查 JDK 17/21、SDK、NDK、Android Studio
npm run setup:android:install      # 未装 IDE 时通过 Homebrew 安装
npm run cocos:android              # Creator 无头构建 → cocos/build/android/proj
npm run cocos:android:open         # 构建后用 Android Studio 打开
npm run cocos:android:apk          # 命令行打 APK（可不打开 IDE）
```

Capacitor Web 壳见仓库根 `mobile/README.md`（`npm run mobile:android` / `mobile:apk:debug`）。

## 4. 命令行无头构建（CI 可选）

不开编辑器也能出包（把路径换成本机 Creator 安装位置）：

```bash
# macOS 示例
/Applications/CocosCreator/Creator/3.8.0/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project "$(pwd)" \
  --build "platform=web-mobile;debug=false"
```

`platform` 可选 `web-mobile / wechatgame / ios / android`。

## 5. 云存档（可选）

`platform/CloudSync` 已提供「本地落盘 + 离线队列 + 在线 flush + pull 合并」；
微信端开箱即用（`wx.setUserCloudStorage/getUserCloudStorage`）。接自有服务端时，
在 `CloudSync.flush()/pull()` 的「非微信」分支替换为你的 HTTP API 即可。

## 注意

- 本工程默认零美术/音频资源即可跑通；接入资源后：
  - 用 `AudioManager.register('place'|'clear'|...)` 注册 `AudioClip`，将自动优先于合成音。
  - 用 Sprite / Spine 替换 `Graphics` 渲染（保持 `BoardView/DockView` 接口不变）。
- `core/` 不依赖任何平台 API，可被 web / 小程序直接复用。
