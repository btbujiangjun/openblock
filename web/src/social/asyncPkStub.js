/**
 * asyncPkStub.js — v10.16 异步盘面挑战（P2 骨架）
 *
 * 大工程占位：用户分享种子让朋友复刻同盘面 PK。
 *
 * 当前实施
 * --------
 * - 仅提供「分享种子」/「输入种子复刻」API 占位
 * - 服务器端需要存储种子 + 分数对（依赖 server.py 加新表）
 *
 * 待实施 TODO
 * -----------
 * 1. server.py 新表：CREATE TABLE pk_challenges (seed, owner, owner_score, opponent, opp_score)
 * 2. /api/pk/create POST { seed, score } → challenge_id
 * 3. /api/pk/{id} GET → { seed, owner_score, opp_score? }
 * 4. UI：分享按钮生成 https://openblock.app/pk/{id}
 * 5. URL 解析：访问 /pk/{id} → 弹窗"挑战 X 的 N 分"，启动同种子局
 * 6. 完成后上报分数 → 显示对比
 *
 * 复用 dailyMaster.js 的种子生成 / spawn 注入逻辑
 */

export function initAsyncPkStub() {
    if (typeof window !== 'undefined') {
        window.__asyncPk = {
            createChallenge: (score) => {
                const seed = Date.now() & 0xffff_ffff;
                console.info('[asyncPk stub] would POST /api/pk/create', { seed, score });
                return { id: null, seed, isImplemented: false };
            },
            joinChallenge: (id) => {
                console.info('[asyncPk stub] would GET /api/pk/' + id);
                return { isImplemented: false };
            },
            isImplemented: () => false,
        };
    }
}
