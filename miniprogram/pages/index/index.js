/**
 * Open Block 微信小程序 — 主菜单页面
 */
const {
  getSkinListMeta,
  getActiveSkinId,
  setActiveSkinId,
} = require('../../core/skins');
const { LEVEL_PACK } = require('../../core/levelPack');

Page({
  data: {
    skins: [{ id: 'titanium', name: '钛晶矩阵' }],
    skinIndex: 0,
    selectedSkinName: '钛晶矩阵',
    levels: [{ id: 'L01', name: '第1关·起步' }],
    levelIndex: 0,
    selectedLevelName: '第1关·起步',
    selectedLevelId: 'L01',
  },

  onLoad() {
    const skins = getSkinListMeta();
    const active = getActiveSkinId();
    let skinIndex = skins.findIndex((s) => s.id === active);
    if (skinIndex < 0) skinIndex = 0;
    const fixedLevels = LEVEL_PACK.map((l) => ({ id: l.id, name: l.name || l.title || l.id }));
    this.setData({
      skins,
      skinIndex,
      selectedSkinName: skins[skinIndex]?.name || '默认皮肤',
      levels: fixedLevels,
      levelIndex: 0,
      selectedLevelName: fixedLevels[0]?.name || '第1关',
      selectedLevelId: fixedLevels[0]?.id || 'L01',
    });
  },

  onSkinChange(e) {
    const idx = Number(e.detail.value) || 0;
    const skin = this.data.skins[idx];
    if (skin) setActiveSkinId(skin.id);
    this.setData({
      skinIndex: idx,
      selectedSkinName: skin?.name || '默认皮肤',
    });
  },

  onLevelChange(e) {
    const idx = Number(e.detail.value) || 0;
    const level = this.data.levels[idx];
    this.setData({
      levelIndex: idx,
      selectedLevelName: level?.name || '第1关',
      selectedLevelId: level?.id || 'L01',
    });
  },

  _withSkin(urlBase) {
    const skin = this.data.skins[this.data.skinIndex];
    const sid = skin?.id || getActiveSkinId();
    return `${urlBase}&skin=${encodeURIComponent(sid)}`;
  },

  onStartNormal() {
    wx.navigateTo({ url: this._withSkin('/pages/game/game?strategy=normal&mode=endless') });
  },
  onStartEasy() {
    wx.navigateTo({ url: this._withSkin('/pages/game/game?strategy=easy&mode=endless') });
  },
  onStartHard() {
    wx.navigateTo({ url: this._withSkin('/pages/game/game?strategy=hard&mode=endless') });
  },

  onStartLevel() {
    const level = this.data.levels[this.data.levelIndex];
    const lid = level?.id || 'L01';
    wx.navigateTo({ url: this._withSkin(`/pages/game/game?strategy=normal&mode=level&levelId=${encodeURIComponent(lid)}`) });
  },
});
