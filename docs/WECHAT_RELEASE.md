# Open Block 微信小程序发布流程（完整说明）

本文档描述从本地开发到微信审核、正式发布及后续运维的**推荐流程**，并与本仓库 `miniprogram/` 目录对齐。微信官方规则以 [微信公众平台文档](https://developers.weixin.qq.com/miniprogram/dev/framework/) 为准；平台政策会变更，发布前请再核对一次后台提示。

---

## 一、前置条件与账号

1. **注册小程序账号**  
   在 [微信公众平台](https://mp.weixin.qq.com/) 注册「小程序」，完成邮箱验证、主体信息（个人 / 企业 / 其他组织）。企业主体通常可开通更多能力（支付、附近的小程序等）。

2. **获取 AppID**  
   登录公众平台 → **开发** → **开发管理** → **开发设置**，复制 **AppID**。在本地将 `miniprogram/project.config.json` 中的 `"appid": ""` 填为你的 AppID（或使用开发者工具「测试号」仅本地调试）。

3. **安装微信开发者工具**  
   从 [官方下载页](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 安装稳定版，使用微信扫码登录。

4. **类目与资质（影响能否上架、是否需补充材料）**  
   在公众平台 → **设置** → **基本设置** → **服务类目** 中选择与产品一致的类目（如休闲游戏类）。部分类目需 **许可证、软著、版号** 等；若 Open Block 以益智消除类上架，请按当前微信对「游戏」类目的要求准备材料（政策会调整，以审核页为准）。

5. **用户隐私与协议**  
   若小程序收集用户信息、使用剪贴板、相册等，需在 **用户隐私保护指引** 中声明；建议在仓库或官网提供《用户协议》《隐私政策》链接，并在审核备注或设置中填写。

---

## 二、本地代码与发布前检查

### 2.1 同步 Web 与共享核心逻辑

仓库内 Web 与小程序共享 `shared/*.json` 及由脚本同步的 `web/src` 纯逻辑：

```bash
cd /path/to/openblock
bash scripts/sync-core.sh
```

同步完成后请阅读脚本末尾提示：`miniprogram/core/config.js` 仍依赖 `envConfig.js` / `adapters/storage.js`，**不在**自动脚本中覆盖。

### 2.2 小程序特有逻辑（人工对齐）

以下模块与 Web 非 1:1 文件对应，改玩法或 UI 后需人工对照：

| 区域 | 路径 |
|------|------|
| 消行加分与 bonus 时长 | `miniprogram/core/bonusScoring.js` |
| Canvas 渲染与粒子 | `miniprogram/utils/renderer.js` |
| 对局状态与顶栏 | `miniprogram/utils/gameController.js`、`pages/game/game.js` |
| 顶栏布局样式 | `pages/game/game.wxml`、`game.wxss` |

### 2.3 环境与网络

- 编辑 `miniprogram/envConfig.js`：`apiBaseUrl`、`syncBackend`、`usePytorchRl` 等。  
- 若使用 `wx.request` 访问自有域名，必须在公众平台配置 **request 合法域名**（HTTPS，备案等要求见官方文档）。

### 2.4 开发者工具内自检

1. **导入项目**：目录选 `miniprogram/`，AppID 选已注册的小程序或测试号。  
2. **编译**：确认无报错；关注 Skyline / 基础库与 `app.json` 中 `libVersion`、`renderer` 配置是否匹配目标用户群。  
3. **真机预览**：扫码在真机上验证 Canvas 拖拽、顶栏、存储（如 `openblock_best_*` 最高分）。  
4. **性能与体积**：查看代码包大小，主包需满足当前平台单包 / 总包限制（以工具与后台提示为准）。

---

## 三、版本号与可审计信息

1. **用户可见版本**  
   在公众平台 **管理** → **版本管理** 中，每次上传会生成开发版本；提审时可填写版本说明（建议对应 Git tag 或 commit 摘要）。

2. **工程配置**  
   `project.config.json` 的 `libVersion` 表示开发者工具模拟的基础库版本；真机以用户微信版本为准。若使用新 API，请在 [基础库兼容性](https://developers.weixin.qq.com/miniprogram/dev/framework/compatibility.html) 中确认最低版本，并在 `app.json` 中设置 `requiredPrivateInfos` 等官方要求的字段（如涉及）。

3. **建议**  
   在 CHANGELOG 或 Git tag 中记录每次提审对应的提交哈希，便于回滚与审核问询。

---

## 四、上传代码与体验版

1. 在开发者工具右上角点击 **上传**。  
2. 填写版本号、项目备注（给团队内部看）。  
3. 上传成功后，登录公众平台 → **管理** → **版本管理**，在 **开发版本** 列表中可见新包。  
4. 将指定成员设为 **体验成员**（成员管理），即可在 **体验版** 中扫码体验，用于内部验收与回归。

---

## 五、提交审核

1. 在 **版本管理** 中，选择开发版本 → **提交审核**。  
2. 按表单填写：  
   - 功能页面与截图（需覆盖主要路径：首页、对局、结束页等）。  
   - 类目、标签、是否含用户生成内容、是否含直播 / 支付等。  
   - **用户隐私同步**：与 `app.json` 及后台「用户隐私保护指引」一致。  
3. **审核时间**：通常 1～7 个工作日，旺季可能延长。  
4. **被拒常见原因**（非穷尽）：类目不符、隐私未声明、测试账号无法体验、内容违规、缺少资质。根据驳回理由修改后重新提交。

---

## 六、发布上线

1. 审核通过后，版本进入 **审核通过、待发布**。  
2. 由管理员在后台点击 **发布**，即可全量上线（具体按钮文案以平台为准）。  
3. **分阶段发布**（若平台提供）：可先小比例灰度，观察崩溃与监控数据再全量。  
4. 发布后可在 **数据统计** 中查看访问、留存（以平台功能为准）。

---

## 七、回滚与版本管理

1. **紧急回滚**：若新版本有严重问题，在 **版本管理** 中查看是否支持回退到上一线上版本（以微信当前能力为准）；部分情况下需重新提交旧包审核。  
2. **长期做法**：保留上一稳定版本的源码压缩包或 Git tag，必要时基于该 tag 重新上传并走审核。

---

## 八、持续运维清单

| 项 | 说明 |
|----|------|
| 合法域名 | HTTPS 证书过期、域名变更时同步更新后台与 `envConfig.js` |
| 用户反馈 | 公众平台 **客服消息** 或小程序内反馈入口 |
| 基础库 | 定期在真机低版本微信上 smoke test |
| 合规 | 内容、广告、未成年人保护等政策更新时复查产品 |

---

## 九、参考链接（官方）

- [小程序开发文档](https://developers.weixin.qq.com/miniprogram/dev/framework/)  
- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/devtools.html)  
- [运营规范](https://developers.weixin.qq.com/miniprogram/product/)  
- [上传与版本管理](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html)（路径以官网最新为准）

---

## 十、与本仓库的对应关系

| 步骤 | 仓库路径 / 命令 |
|------|-----------------|
| 核心同步 | `bash scripts/sync-core.sh` |
| 小程序根目录 | `miniprogram/` |
| 适配说明 | [WECHAT_MINIPROGRAM.md](./WECHAT_MINIPROGRAM.md) |

将本文档与 `WECHAT_MINIPROGRAM.md` 一并作为团队发布与 onboarding 资料即可。
