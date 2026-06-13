/**
 * Open Block 微信小程序 — 主菜单页面
 */
const {
  getSkinListMeta,
  getActiveSkinId,
  setActiveSkinId,
  getSkinCategories,
} = require('../../core/skins');
const {
  getLanguage,
  setLanguage,
  getLanguageList,
  t,
} = require('../../core/i18n');
const { createAudioFx } = require('../../utils/audioFx');

const DIFFICULTIES = [
  { id: 'easy', labelKey: 'difficultyEasy' },
  { id: 'normal', labelKey: 'difficultyNormal' },
  { id: 'hard', labelKey: 'difficultyHard' },
];

Page({
  data: {
    skins: [{ id: 'titanium', name: '钛晶矩阵' }],
    skinIndex: 0,
    selectedSkinName: '钛晶矩阵',
    skinCategories: [],
    skinMultiRange: [[], []],
    skinMultiIndex: [0, 0],
    languages: [{ id: 'zh-CN', name: '简体中文' }],
    languageIndex: 0,
    selectedLanguageName: '简体中文',
    difficulties: [],
    difficultyIndex: 1,
    selectedDifficultyName: '普通模式',
    audioOn: true,
    text: {},
  },
  _audio: null,

  onLoad() {
    this._audio = createAudioFx();
    this._syncAudioState();
    this._refreshText();
    const skins = getSkinListMeta();
    const active = getActiveSkinId();
    this._audio.setSkinTheme?.(active);
    if (this.data.audioOn) this._audio.warmup(['tick', 'select', 'place']);
    let skinIndex = skins.findIndex((s) => s.id === active);
    if (skinIndex < 0) skinIndex = 0;
    const languages = getLanguageList();
    const lang = getLanguage();
    let languageIndex = languages.findIndex((x) => x.id === lang);
    if (languageIndex < 0) languageIndex = 0;
    const difficulties = this._difficultyOptions();
    const skinCatData = this._buildSkinCategoryData(active);
    this.setData({
      skins,
      skinIndex,
      selectedSkinName: skins[skinIndex]?.name || '默认皮肤',
      ...skinCatData,
      languages,
      languageIndex,
      selectedLanguageName: languages[languageIndex]?.name || '简体中文',
      difficulties,
      difficultyIndex: 1,
      selectedDifficultyName: difficulties[1]?.name || t('difficultyNormal'),
    });
  },

  onShow() {
    if (!this._audio) this._audio = createAudioFx();
    this._syncAudioState();
  },

  _syncAudioState() {
    const prefs = this._audio?.getPrefs?.() || { sound: true };
    this.setData({ audioOn: prefs.sound !== false });
  },

  onToggleAudio() {
    if (!this._audio) this._audio = createAudioFx();
    const current = this._audio.getPrefs?.() || { sound: true };
    const next = !current.sound;
    this._audio.setEnabled(next);
    this._audio.setHaptic?.(next);
    this.setData({ audioOn: next });
    if (next) {
      this._audio.warmup(['tick', 'select', 'place', 'unlock']);
      this._audio.play('tick');
    }
  },

  _refreshText() {
    this.setData({
      text: {
        title: t('title'),
        subtitle: t('subtitle'),
        skin: t('skin'),
        language: t('language'),
        difficulty: t('difficulty'),
        startGame: t('startGame'),
        footer: t('footer'),
      },
      difficulties: this._difficultyOptions(),
    });
  },

  _difficultyOptions() {
    return DIFFICULTIES.map((x) => ({ id: x.id, name: t(x.labelKey) }));
  },

  _buildSkinCategoryData(activeSkinId) {
    const cats = getSkinCategories();
    const catNames = cats.map((c) => c.label);
    let catIdx = 0;
    let skinIdx = 0;
    for (let ci = 0; ci < cats.length; ci++) {
      const si = cats[ci].skins.findIndex((s) => s.id === activeSkinId);
      if (si >= 0) { catIdx = ci; skinIdx = si; break; }
    }
    const skinNames = cats[catIdx]?.skins.map((s) => s.name) || [];
    return {
      skinCategories: cats,
      skinMultiRange: [catNames, skinNames],
      skinMultiIndex: [catIdx, skinIdx],
    };
  },

  onSkinColumnChange(e) {
    const { column, value } = e.detail;
    const cats = this.data.skinCategories;
    if (column === 0) {
      const skinNames = cats[value]?.skins.map((s) => s.name) || [];
      this.setData({
        'skinMultiIndex[0]': value,
        'skinMultiIndex[1]': 0,
        'skinMultiRange[1]': skinNames,
      });
    }
  },

  onSkinChange(e) {
    const [catIdx, skinIdx] = e.detail.value.map(Number);
    const cats = this.data.skinCategories;
    const skin = cats[catIdx]?.skins[skinIdx];
    if (skin) {
      setActiveSkinId(skin.id);
      this._audio?.setSkinTheme?.(skin.id);
      const skins = this.data.skins;
      const flatIdx = skins.findIndex((s) => s.id === skin.id);
      this._audio?.feedback('unlock', { force: true });
      this.setData({
        skinIndex: flatIdx >= 0 ? flatIdx : 0,
        selectedSkinName: skin.name,
        skinMultiIndex: [catIdx, skinIdx],
      });
    }
  },

  onLanguageChange(e) {
    const idx = Number(e.detail.value) || 0;
    const lang = this.data.languages[idx];
    if (lang) setLanguage(lang.id);
    this._audio?.feedback('select');
    const skins = getSkinListMeta();
    const skin = this.data.skins[this.data.skinIndex];
    const skinIndex = Math.max(0, skins.findIndex((s) => s.id === skin?.id));
    const difficulties = this._difficultyOptions();
    const skinCatData = this._buildSkinCategoryData(skin?.id || getActiveSkinId());
    this.setData({
      skins,
      skinIndex,
      selectedSkinName: skins[skinIndex]?.name || t('skin'),
      ...skinCatData,
      languageIndex: idx,
      selectedLanguageName: lang?.name || '简体中文',
      difficulties,
      selectedDifficultyName: difficulties[this.data.difficultyIndex]?.name || t('difficultyNormal'),
    });
    this._refreshText();
  },

  onDifficultyChange(e) {
    const idx = Number(e.detail.value) || 0;
    const difficulty = this.data.difficulties[idx];
    this._audio?.feedback('select');
    this.setData({
      difficultyIndex: idx,
      selectedDifficultyName: difficulty?.name || t('difficultyNormal'),
    });
  },

  _gameUrl() {
    const skin = this.data.skins[this.data.skinIndex];
    const sid = skin?.id || getActiveSkinId();
    const difficulty = this.data.difficulties[this.data.difficultyIndex];
    const strategy = difficulty?.id || 'normal';
    return `/pages/game/game?strategy=${encodeURIComponent(strategy)}&skin=${encodeURIComponent(sid)}&lang=${encodeURIComponent(getLanguage())}`;
  },

  onStartGame() {
    this._audio?.feedback('place');
    wx.navigateTo({ url: this._gameUrl() });
  },
});
