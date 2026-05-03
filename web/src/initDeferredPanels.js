/**
 * 首屏与 `game.init()` 成功后再加载的模块：减小主 bundle、加快可玩内容出现。
 * 回放列表 `initReplayUI` / 玩家洞察仍留在 main.js 靠前位置，以便 API 失败时仍可只读回放。
 *
 * 详见 docs/engineering/PERFORMANCE.md。
 */

/**
 * @param {{ game: object }} ctx
 */
export async function initDeferredPanels(ctx) {
    const { game } = ctx;
    const [
        rlMod,
        spawnMod,
        levelMod,
        albumMod,
        dashMod,
        seasonMod,
        passEntryMod,
    ] = await Promise.all([
        import('./bot/rlPanel.js'),
        import('./spawnModelPanel.js'),
        import('./levelEditorPanel.js'),
        import('./social/replayAlbum.js'),
        import('./progression/personalDashboard.js'),
        import('./seasonPass.js'),
        import('./daily/seasonPassEntry.js'),
    ]);

    rlMod.initRLPanel(game);
    spawnMod.initSpawnModelPanel(game);
    levelMod.initLevelEditorPanel(game);

    const leBtn = document.getElementById('level-editor-btn');
    if (leBtn) {
        leBtn.addEventListener('click', levelMod.openLevelEditorPanel);
    }

    albumMod.initReplayAlbum({ game });
    dashMod.initPersonalDashboard();

    const seasonPass = seasonMod.initSeasonPass(game);
    if (typeof window !== 'undefined') {
        window.__seasonPass = seasonPass;
    }
    document.getElementById('season-pass-btn')?.addEventListener('click', () => seasonMod.toggleSeasonPass());
    passEntryMod.initSeasonPassEntry({ seasonPass, toggleSeasonPass: seasonMod.toggleSeasonPass });
}
