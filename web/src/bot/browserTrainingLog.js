/**
 * 浏览器端 RL 训练指标环形缓冲，供右侧看板与 PyTorch 的 training.jsonl 同结构读取。
 */
const STORAGE_KEY = 'bb_rl_browser_training_log_v1';
const MAX_ENTRIES = 3000;

/**
 * @param {object} row 与 rl_backend train_episode 行对齐
 * @param {number} row.episodes
 * @param {number} [row.loss_policy]
 * @param {number} [row.loss_value]
 * @param {number} [row.entropy]
 * @param {number} [row.step_count]
 * @param {number} [row.score]
 * @param {boolean} [row.won]
 */
export function appendBrowserTrainEpisode(row) {
    if (typeof row.episodes !== 'number' || !Number.isFinite(row.episodes)) {
        return;
    }
    let list = [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
    } catch {
        list = [];
    }
    const entry = {
        event: 'train_episode',
        ts: Math.floor(Date.now() / 1000),
        episodes: row.episodes,
        loss_policy: row.loss_policy,
        loss_value: row.loss_value,
        entropy: row.entropy,
        step_count: row.step_count,
        score: row.score,
        won: row.won,
        source: 'browser'
    };
    list.push(entry);
    while (list.length > MAX_ENTRIES) {
        list.shift();
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
        /* quota */
    }
}

/**
 * @param {number} tail
 * @returns {{ entries: object[], path: string, exists: boolean }}
 */
export function getBrowserTrainingLog(tail = 800) {
    let list = [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
    } catch {
        list = [];
    }
    const n = Math.max(1, Math.floor(tail));
    const slice = list.slice(-n);
    return { entries: slice, path: 'localStorage:' + STORAGE_KEY, exists: list.length > 0 };
}

export function clearBrowserTrainingLog() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore */
    }
}
