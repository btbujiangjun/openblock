-- ─────────────────────────────────────────────────────────────────────
-- OpenBlock 出块算法寻参系统 v2.0 — SQL Schema
--
-- 设计文档: docs/algorithms/SPAWN_TUNING_V2.md
--
-- 4 张主表:
--   sample_sets     — 样本集 (CRUD + 集合运算)
--   samples         — 单样本 (含 20 维 d_curve 标签)
--   models          — 训出的模型 (版本树)
--   training_jobs   — 训练任务队列
--
-- 设计原则:
--   - sample_sets first-class, 不再用 run_id 兼用
--   - 全部表带 created_at + status 字段, 便于运维
--   - ON DELETE CASCADE 自动清理
--   - 关键查询路径建索引
-- ─────────────────────────────────────────────────────────────────────

-- ─────── 1. 样本集 (Sample Sets) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS sample_sets (
    set_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    description   TEXT DEFAULT '',
    config_json   TEXT DEFAULT '{}',     -- 采集时的完整配置 (chips/权重/参数空间版本)
    sample_count  INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'collecting'
                  CHECK (status IN ('collecting', 'completed', 'archived', 'failed')),
    tags          TEXT DEFAULT '',       -- 逗号分隔
    parent_set_id INTEGER REFERENCES sample_sets(set_id) ON DELETE SET NULL,
    created_at    INTEGER NOT NULL,      -- unix seconds
    completed_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sample_sets_status     ON sample_sets(status);
CREATE INDEX IF NOT EXISTS idx_sample_sets_created    ON sample_sets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sample_sets_parent     ON sample_sets(parent_set_id);


-- ─────── 2. 单样本 (Samples) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS samples (
    sample_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id          INTEGER NOT NULL
                    REFERENCES sample_sets(set_id) ON DELETE CASCADE,

    -- ── 5 维 context ──
    difficulty      TEXT NOT NULL
                    CHECK (difficulty IN ('easy', 'normal', 'hard')),
    generator       TEXT NOT NULL
                    CHECK (generator IN ('triplet-p1', 'budget-p2')),
    bot_policy      TEXT NOT NULL
                    CHECK (bot_policy IN ('random', 'clear-greedy', 'survival')),
    pb_bin          INTEGER NOT NULL
                    CHECK (pb_bin IN (500, 1500, 4000, 10000, 25000)),
    lifecycle_stage TEXT NOT NULL
                    CHECK (lifecycle_stage IN ('onboarding', 'growth', 'mature', 'plateau')),

    -- ── 14 维 θ (JSON) ──
    theta_json      TEXT NOT NULL,

    -- ── 标签 ──
    d_curve_json    TEXT NOT NULL,        -- length 20 float array, JSON
    final_score     INTEGER,
    survived_steps  INTEGER,
    clear_rate      REAL,
    noMove_step     INTEGER,               -- -1 = 未死局
    pb_broke        INTEGER NOT NULL DEFAULT 0,
    surprise_count  INTEGER NOT NULL DEFAULT 0,

    -- ── 元信息 ──
    seed            INTEGER,
    eval_ms         INTEGER,
    evaluated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_samples_set      ON samples(set_id);
CREATE INDEX IF NOT EXISTS idx_samples_ctx      ON samples(difficulty, generator, bot_policy, pb_bin, lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_samples_pb_broke ON samples(pb_broke);
CREATE INDEX IF NOT EXISTS idx_samples_eval_at  ON samples(evaluated_at DESC);


-- ─────── 3. 模型 (Models) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS models (
    model_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    version         TEXT DEFAULT 'v0.0.1',   -- semver
    model_type      TEXT NOT NULL
                    CHECK (model_type IN ('linear', 'gbdt', 'mlp', 'resnet')),
    weights_path    TEXT,                     -- 文件系统路径
    sha256          TEXT,                     -- 64 字符 hex
    size_bytes      INTEGER,
    parent_model_id INTEGER REFERENCES models(model_id) ON DELETE SET NULL,
    train_job_id    INTEGER,                  -- 反向引用,延迟到 jobs 表创建后
    metrics_json    TEXT DEFAULT '{}',        -- val_loss / curve_mae / balance / surprise_rate ...
    status          TEXT NOT NULL DEFAULT 'staging'
                    CHECK (status IN ('staging', 'deployed', 'archived', 'rollbacked')),
    tags            TEXT DEFAULT '',
    created_at      INTEGER NOT NULL,
    deployed_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_models_status     ON models(status);
CREATE INDEX IF NOT EXISTS idx_models_parent     ON models(parent_model_id);
CREATE INDEX IF NOT EXISTS idx_models_created    ON models(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_models_deployed   ON models(deployed_at DESC) WHERE status = 'deployed';


-- ─────── 4. 训练任务 (Training Jobs) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS training_jobs (
    job_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT,
    status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
    model_type        TEXT NOT NULL,
    arch_json         TEXT DEFAULT '{}',     -- 超参 (层数/隐藏单元/dropout/...)
    loss_weights      TEXT DEFAULT '{}',     -- α β γ δ ε
    sample_set_ids    TEXT NOT NULL,         -- JSON array, 支持多集合 union
    base_model_id     INTEGER REFERENCES models(model_id) ON DELETE SET NULL,
    output_model_id   INTEGER REFERENCES models(model_id) ON DELETE SET NULL,

    -- 训练监控 (训完才有值)
    train_loss        REAL,
    val_loss          REAL,
    val_curve_mae     REAL,
    val_balance       REAL,
    val_surprise_rate REAL,
    val_breaking      REAL,
    epochs_done       INTEGER DEFAULT 0,

    log_path          TEXT,                    -- JSONL 训练日志文件
    error_message     TEXT,                    -- 失败时的错误

    started_at        INTEGER,
    completed_at      INTEGER,
    created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status      ON training_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created     ON training_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_base_model  ON training_jobs(base_model_id);


-- ─────── 5. 样本集运算审计 (lineage) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS sample_set_lineage (
    lineage_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    output_set_id INTEGER NOT NULL REFERENCES sample_sets(set_id) ON DELETE CASCADE,
    op_type       TEXT NOT NULL
                  CHECK (op_type IN ('union', 'intersect', 'subtract', 'filter', 'sample')),
    input_set_ids TEXT NOT NULL,                -- JSON array
    filter_json   TEXT,                         -- 筛选条件
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lineage_output ON sample_set_lineage(output_set_id);


-- ─────── 6. Schema 版本号 ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spawn_tuning_v2_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
INSERT OR REPLACE INTO spawn_tuning_v2_meta (key, value)
    VALUES ('schema_version', 'v2.0.0'),
           ('schema_created_at', strftime('%s', 'now')),
           ('description', 'Spawn Tuning v2 schema — d_curve labels + ResNet-MLP');
