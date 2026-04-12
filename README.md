# Open Block

网页方块益智游戏：拖拽多连块布局盘面、成行/列可得分；会话、行为、统计与回放经 **Flask API** 写入仓库内 **SQLite**（`blockblast.db`，可用 `BLOCKBLAST_DB_PATH` 覆盖）。开发时需同时跑 `npm run dev` 与 `npm run server`。

## 仓库结构

| 路径 | 说明 |
|------|------|
| `web/index.html` | 页面壳，仅挂载脚本入口 |
| `web/src/` | 业务源码（ESM），按职责拆分模块 |
| `web/public/styles/main.css` | 全局样式（Vite `public/`，由 `index.html` 直链） |
| `server.py` | Flask API，`import` 时执行 `init_db()` |
| `docs/PROJECT.md` | 架构与数据流补充说明 |
| `tests/` | Vitest 单测 |
| `web/src/bot/` | 强化学习自博弈（REINFORCE + 基线），左上角面板可调参/看胜率 |
| `rl_pytorch/` | **PyTorch** 自博弈训练（残差双塔策略/价值网络；**MPS** / CUDA / CPU，见 `requirements-rl.txt`） |

## 环境要求

- Node.js 18+（前端开发与构建）
- Python 3.10+（持久化与可选分析 API）

## 快速开始

### 前端（推荐）

```bash
npm install
npm run dev
```

浏览器访问 Vite 提示的地址（默认 `http://localhost:3000`）。入口脚本为 `web/src/main.js`；样式在 `web/public/styles/main.css`，**勿**仅用「打开根目录的 HTML」配合错误站点根路径（会导致 `/src/main.js` 404、页面无样式且各层叠在一起）。请始终 `npm run dev`，或将静态服务器的站点根设为 `web/`。

构建产物输出到 `dist/`，可由任意静态服务器托管：

```bash
npm run build
npm run preview
```

### PyTorch 自博弈训练（可选）

```bash
pip install -r requirements-rl.txt
# Apple Silicon 上通常可用 GPU：--device mps；默认 --device auto（cuda > mps > cpu）
# M4/MPS 吞吐：`rl_pytorch.train` 与 Flask `/api/rl/train_episode` 会在 MPS 上自动 `set_float32_matmul_precision('high')` 并使用 Adam `foreach=True`；勿开 `RL_MPS_SYNC` 除非需要同步排错（见 `.env.example`）
python -m rl_pytorch.train --episodes 2000 --device auto --save-every 100 --save rl_checkpoints/bb_policy.pt
```

`--resume` 可断点续训；`--width` / `--policy-depth` / `--value-depth` 可调网络规模。

**与网页 RL 面板联动（热启动 + 持续学习）**：先训练或准备好 `rl_checkpoints/bb_policy.pt`，启动 Flask 时设置环境变量 `RL_CHECKPOINT`（可选 `RL_CHECKPOINT_SAVE`）。**Mac（Apple Silicon）** 上 `RL_DEVICE=auto` 与 `python -m rl_pytorch.train --device auto` 均会优先使用 **MPS**。`npm run server:rl` 已默认 **`RL_AUTOLOAD=1`**（若存在 `rl_checkpoints/bb_policy.pt` 则热加载）、**`RL_SAVE_EVERY=100`** 定期存盘（降低写盘频率以加快训练）、**`RL_TRAINING_LOG=rl_checkpoints/training.jsonl`** 追加训练日志；页面 RL 面板可「刷新日志」拉取 `/api/rl/training_log`。详见 `docs/PROJECT.md` 与 `.env.example`。

### 环境变量（前端）

在**仓库根目录**或 `web/` 下创建 `.env.local`（参见根目录 `.env.example`）：

- `VITE_API_BASE_URL` — API 根地址，默认 `http://localhost:5000`
- `VITE_USE_SQLITE_DB` — 默认启用；为 `false` 时前端拒绝初始化（无浏览器 IndexedDB 回退）
- `VITE_SYNC_BACKEND` — 设为 `true` 时使用第二套远端会话同步（`PUT` 结束会话会更新 `user_stats`；与主 SQLite 流程并存时易重复计分，一般保持 `false`）

Vite 已配置 `envDir: '..'`，根目录 `.env*` 会被加载。

### 后端（持久化必需）

```bash
pip install -r requirements.txt
npm run server
# 或: python3 server.py
```

- 数据库路径：`BLOCKBLAST_DB_PATH`（默认：仓库内 `blockblast.db`）
- 端口：`PORT`（默认 `5000`）
- 调试：`FLASK_DEBUG=1`

生产部署可使用 `gunicorn server:app`（模块导入时已建表）。

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | Vite 开发服务器 |
| `npm run build` | 生产构建 |
| `npm run preview` | 预览 `dist/` |
| `npm test` | Vitest |
| `npm run lint` | ESLint（`web/src`、`tests`） |
| `npm run server` | 启动 Flask |

## 代码约定

- **单一数据源**：游戏逻辑仅维护于 `web/src/`，禁止再回到巨型内联脚本。
- **后端**：`Database` 通过 `fetch` 调用 Flask；`BackendSync` 仅在 `VITE_SYNC_BACKEND=true` 且未走 SQLite 主路径时额外同步（避免与 `PATCH /api/session` 重复结束会话）。
- **成就 id**：与 `ACHIEVEMENTS_BY_ID` 中字符串一致（如 `score_100`、`ten_games`）。

## 许可证

MIT
