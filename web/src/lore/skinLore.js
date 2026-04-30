/**
 * skinLore.js — v10.16 皮肤剧情图鉴（P1）
 *
 * 全量皮肤每款 1 段 ~120 字小故事 / 设计灵感，构建"收藏感"。
 * 在皮肤选择面板加「图鉴」按钮，弹出叙事卡片，可逐款翻阅。
 *
 * v10.17.4：新增 outdoor 户外运动主题文案。
 */

import { SKINS, SKIN_LIST, getActiveSkinId, setActiveSkinId } from '../skins.js';
import { tSkinName } from '../i18n/i18n.js';
import { paintMahjongLorePreviewTile } from '../renderer.js';

/** 图鉴 canvas 的 a11y 简名（与 blockIcons 次序一致） */
const _MAHJONG_LORE_ARIA = ['东', '南', '西', '北', '发', '万', '筒', '索'];
/** 与其它皮肤图鉴 emoji 格 ~38px 视觉对齐，麻将 canvas 略放大 */
const _MAHJONG_LORE_TILE_PX = 54;

function _mountMahjongLoreCanvases(panel) {
    const wrap = panel.querySelector('.lore-card__icons--mahjong');
    if (!wrap) return;
    const skin = SKINS.mahjong;
    const colors = skin.blockColors;
    if (!colors?.length || !(skin.blockIcons?.length)) return;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const px = _MAHJONG_LORE_TILE_PX;
    wrap.querySelectorAll('canvas.lore-mj-tile').forEach((canvas, i) => {
        if (i >= 8) return;
        const label = _MAHJONG_LORE_ARIA[i] || `tile ${i + 1}`;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', label);
        canvas.width = Math.round(px * dpr);
        canvas.height = Math.round(px * dpr);
        canvas.style.width = `${px}px`;
        canvas.style.height = `${px}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        paintMahjongLorePreviewTile(ctx, px, colors[i]);
    });
}

const LORE = {
    classic:    '原版方块的回响——黑色画布上跳动的彩色棱角，是 1984 那个莫斯科冬夜里的电子幽灵。',
    titanium:   '钛晶基板冷峻反光，每个方块是一片航天合金切片，落定时是金属缓冲器的低沉哑声。',
    aurora:     '北纬 65° 的极夜，七色光带从天顶垂下。落子时，光带也跟着你的手势波动。',
    neonCity:   '霓虹城市的天台，午夜尽头的 DJ 在天台播放迷幻浪潮——这一局，是给夜行者的礼物。',
    ocean:      '深海三千米的静谧，每一次消行都激起一圈蓝绿色涟漪——你是潜水员，也是潮汐。',
    sunset:     '黄金时刻，天空被泼洒成胭脂与琥珀。这一刻请专注落子，因为光会褪去。',
    lava:       '火山口边缘的炽热——岩浆在脚下流淌，方块是凝固的玄武岩，消行是新一次喷涌。',
    sakura:     '京都四月的午后，樱花瓣在风里旋转。每次盘面清空，是一片落花终于触地的瞬间。',
    koi:        '锦鲤池塘的涟漪，水底锦鲤逆流而上。中秋月圆时，盘面与月光共振。',
    candy:      '糖果工厂深夜的传送带，方块是即将出厂的彩色软糖。生日蛋糕的味道，藏在每次 bonus 里。',
    bubbly:     '浅海与沙滩都在同一层果冻里：水獭翻身、沙岸泛白、气泡上浮爆裂——清凉感是真实存在的。',
    toon:       '童年录像带里的卡通——方块边缘是粗黑描边，落子的"啪"声像漫画里的拟声词。',
    pixel8:     '8-bit 像素的纯粹——这里没有抗锯齿，没有阴影，只有方块的"咚"和清行的"叮"。',
    dawn:       '黎明前最暗的一刻，盘面像乳白色的雾。第一缕光在你按下时升起。',
    food:       '深夜食堂的菜单——披萨、汉堡、寿司、面条……盘面是肠胃的快乐，分数是饱腹感。',
    music:      '音符在线谱上跳舞——每次落子是一个 staccato，连击是一段小调，盘面清空是和声完美收束。',
    pets:       '宠物医院的候诊厅——猫狗鼠兔鸟乌龟在方块里探头。它们是和你一起玩的伙伴。',
    universe:   '银河旋臂上的一颗孤星，方块是行星的引力捕获带——每次清行，是一次微型超新星。',
    fantasy:    '水晶秘境的紫色走廊——精灵的鳞光、宝石的折射、巫师的尾烟，全都在方块里。',
    fairy:      '萤火虫成群的玫瑰花丛——每盏小灯都是一个未实现的愿望。',
    beast:      '远古丛林的动物纹章——豹、鹰、虎、狼……他们是方块的守护神，落子是他们的低吼。',
    greece:     '爱琴海岸的白蓝——希腊神庙的廊柱在落日下变得透明。橄榄油的气味会从方块里渗出。',
    demon:      '血赤褐色的炼狱角落，恶魔在角落看着你。每次 perfect，是他们的一次叹息。',
    jurassic:   '白垩纪的密林——恐龙的鳞片化石在方块里反光。我们都是亿年后的玩家。',
    industrial: '齿轮、钳子、链条——19 世纪的英国蒸汽朋克车间。这一局，机械之神在帮你作弊。',
    forbidden:  '紫禁城的红墙金顶——每个方块是一片琉璃瓦，每次消行是一根梁柱归位。',
    mahjong:    '老北京胡同的茶馆，烟雾缭绕的牌桌——东风、發、红中……每张牌都是一段江湖。',
    boardgame:  '赌场天鹅绒桌的鎏金灯下——黑桃、红心、方片、梅花铺开，大王压底，旁边花札暗藏一枝樱，老虎机的转轮在远处叮当作响，骰子刚刚停下。',
    sports:     '体育场的灯光下——足球、篮球、网球、保龄球……每次清行，看台上爆出一阵欢呼。',
    outdoor:    '黎明前的山谷——登山靴扣紧鞋带，帐篷里咖啡正煮。冲浪板斜靠车后座，雪道还在远方等待。',
    vehicles:   '城市快速路的午夜——出租车的尾灯、警车的红蓝、消防车的红……车流里的方块流。',
    forest:     '北欧森林的清晨，落叶在脚下。鹿群从远处跑过，麋角是鞭挞光线的玻璃。',
    pirate:     '加勒比海湾的霜寒清晨——船帆、宝藏、骷髅旗。每次 bonus，是埋藏宝藏的回响。',
    farm:       '田园农庄的丰收季——麦穗、玉米、苹果、奶牛……盘面是地里长出的方块。',
    desert:     '沙漠绿洲的正午——骆驼商队远远走过，仙人掌花在沙丘下静静开放。',
    /* 隐藏皮肤（Konami 解锁） */
    og_geometry: '1984 莫斯科的那个冬夜——电子幽灵从此栖居在每一个方块里。这是它的本来面目。',
};

let _audio = null;
let _keyHandler = null;

export function initSkinLore({ audio = null } = {}) {
    _audio = audio;
    setTimeout(_injectButton, 1500);
    if (typeof window !== 'undefined') {
        window.__skinLore = { open: openLore, getStory: (id) => LORE[id] || '' };
    }
}

function _injectButton() {
    const skinSelect = document.getElementById('skin-select');
    if (!skinSelect) return;
    if (document.getElementById('skin-lore-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'skin-lore-btn';
    btn.className = 'skin-lore-btn';
    btn.title = '查看皮肤背景故事';
    btn.textContent = '📖';
    btn.addEventListener('click', () => openLore(skinSelect.value));
    skinSelect.parentNode?.appendChild(btn);
}

export function openLore(skinId) {
    const id = skinId || getActiveSkinId();
    let panel = document.getElementById('skin-lore-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'skin-lore-panel';
        panel.className = 'skin-lore-panel';
        document.body.appendChild(panel);
    }
    const ids = SKIN_LIST.map(s => s.id);
    let cursor = ids.indexOf(id);
    if (cursor < 0) cursor = 0;
    _renderPage(panel, cursor, ids);
    panel.classList.add('is-visible');
    _installKeyboardNav(panel, ids);
}

function _installKeyboardNav(panel, ids) {
    if (typeof document === 'undefined') return;
    if (_keyHandler) document.removeEventListener('keydown', _keyHandler);
    _keyHandler = (e) => {
        if (!panel.classList.contains('is-visible')) return;
        if (e.key === 'Escape') {
            panel.classList.remove('is-visible');
            e.preventDefault();
            return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const cur = ids.indexOf(panel.dataset.cursor || ids[0]);
            const idx = cur < 0 ? 0 : cur;
            const next = e.key === 'ArrowLeft'
                ? (idx - 1 + ids.length) % ids.length
                : (idx + 1) % ids.length;
            _audio?.play?.('tick');
            _renderPage(panel, next, ids);
            e.preventDefault();
        }
    };
    document.addEventListener('keydown', _keyHandler);
}

function _escape(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

/**
 * 6 个 watermark 位置预设：散落在卡片四周（左上 / 右上 / 左中 / 右中 / 左下 / 右下），
 * 中央留空保证正文可读；中部两个图标尺寸较大但 opacity 较低，营造"质感"。
 * 中下 / 中央位置避开（正文居中文字 + footer 按钮区域）。
 */
const WATERMARK_PRESETS = [
    { top: '6%',  left: '4%',   rotate: -15, size: 52 },
    { top: '8%',  right: '6%',  rotate: 18,  size: 58 },
    { top: '38%', left: '-3%',  rotate: -8,  size: 96 },
    { top: '42%', right: '-5%', rotate: 12,  size: 90 },
    { top: '70%', left: '6%',   rotate: 14,  size: 50 },
    { top: '72%', right: '8%',  rotate: -10, size: 60 },
];

/**
 * 渲染卡片背景水印：复用皮肤盘面的 boardWatermark.icons，让图鉴卡与游戏盘面视觉呼应。
 * - icons 不足 6 个时循环复用
 * - opacity 在 boardWatermark.opacity 基础上略提（卡片背景偏暗，需更亮）
 * - 卡片整体 overflow: hidden，超出部分被剪裁形成"边缘半截"的纸质纹理
 */
function _renderWatermark(skin) {
    const wm = skin.boardWatermark || {};
    const icons = Array.isArray(wm.icons) && wm.icons.length > 0
        ? wm.icons
        : (skin.blockIcons || []).slice(0, 4);
    if (!icons || icons.length === 0) return '';
    const baseOpacity = (typeof wm.opacity === 'number' ? wm.opacity : 0.08);
    const opacity = Math.min(0.18, baseOpacity * 1.6);   // 卡片背景比盘面更暗，需提亮
    return WATERMARK_PRESETS.map((p, i) => {
        const icon = icons[i % icons.length];
        const horizCss = p.left !== undefined ? `left:${p.left}` : `right:${p.right}`;
        return `<span style="top:${p.top};${horizCss};font-size:${p.size}px;transform:rotate(${p.rotate}deg);opacity:${opacity}">${_escape(icon)}</span>`;
    }).join('');
}

/**
 * 把皮肤故事拆解为「古诗式」短句结构：
 * 1. 先以 `——` 切分，把它单独提为「停顿」行
 * 2. 其余按 `，；。：` 切分，每个短句独立一行（标点保留在行末）
 * 3. 每行包裹 span，由 CSS 控制居中、衬线字体、行间距
 *
 * 例：「火山口边缘的炽热——岩浆在脚下流淌，方块是凝固的玄武岩，消行是新一次喷涌。」
 *  →  火山口边缘的炽热 / —— / 岩浆在脚下流淌， / 方块是凝固的玄武岩， / 消行是新一次喷涌。
 */
function _formatPoem(story) {
    if (typeof story !== 'string' || !story) return '';
    const tokens = story.split(/(——)/g);   // 保留 —— 作为 token
    const html = [];
    for (const t of tokens) {
        if (!t) continue;
        if (t === '——') {
            html.push('<span class="lore-poem-pause">——</span>');
            continue;
        }
        const subParts = t.split(/(?<=[，；。：])/);
        for (const p of subParts) {
            const trimmed = p.trim();
            if (!trimmed) continue;
            html.push(`<span class="lore-poem-line">${_escape(trimmed)}</span>`);
        }
    }
    return html.join('');
}

function _renderPage(panel, cursor, ids) {
    const id = ids[cursor];
    const skin = SKINS[id];
    if (!skin) return;
    panel.dataset.cursor = id;   // 让键盘 handler 能取到当前光标
    const story = LORE[id] || '该皮肤的故事尚未编写。';
    const isActive = getActiveSkinId() === id;
    // 卡片用主题色 accent 驱动 hero 渐变 / 边框光晕：让每款皮肤的图鉴卡有独特调性
    // skin.name 自带 emoji 前缀（如「🌅 暮色日落」），不再额外注入避免重复
    // 各皮肤的主题色 99% 都在 cssVars['--accent-color']，单独 accent 字段几乎没设置
    const accent = (skin.cssVars && skin.cssVars['--accent-color'])
        || skin.accent
        || skin.gridLine
        || '#38bdf8';

    // icon 阵列：取 blockIcons 前 8 个（覆盖 8 种 colorIdx），让玩家看到该皮肤完整元素集
    const blockIcons = (skin.blockIcons || []).slice(0, 8);
    const iconsClass = id === 'mahjong'
        ? 'lore-card__icons lore-card__icons--mahjong'
        : 'lore-card__icons';
    const iconRow = blockIcons.length > 0
        ? `<div class="${iconsClass}" aria-label="该主题的方块图标">
              ${id === 'mahjong'
            ? blockIcons.map(() => '<canvas class="lore-mj-tile"></canvas>').join('')
            : blockIcons.map(e => `<span>${_escape(e)}</span>`).join('')}
           </div>`
        : '';

    panel.innerHTML = `
        <div class="lore-card" style="--accent-color:${_escape(accent)}">
            <div class="lore-bg-watermark" aria-hidden="true">${_renderWatermark(skin)}</div>
            <div class="lore-card__head">
                <h3 class="lore-skin-name">${_escape(tSkinName(skin))}</h3>
                <button type="button" class="lore-close" aria-label="关闭">×</button>
            </div>
            <div class="lore-card__divider">
                <span class="lore-divider-line"></span>
                <span class="lore-divider-mark">主题&nbsp;${cursor + 1}&nbsp;/&nbsp;${ids.length}</span>
                <span class="lore-divider-line"></span>
            </div>
            ${iconRow}
            <div class="lore-card__body">
                <p class="lore-story">${_formatPoem(story)}</p>
            </div>
            <div class="lore-card__foot">
                <button type="button" class="lore-prev" aria-label="上一款">‹</button>
                <button type="button" class="lore-try-btn" ${isActive ? 'data-active="true" disabled' : ''}>
                    <span class="lore-try-btn__icon">${isActive ? '✓' : '✦'}</span>${isActive ? '当前使用中' : '使用此皮肤'}
                </button>
                <button type="button" class="lore-next" aria-label="下一款">›</button>
            </div>
        </div>
    `;

    if (id === 'mahjong') _mountMahjongLoreCanvases(panel);

    panel.querySelector('.lore-close').addEventListener('click', () => panel.classList.remove('is-visible'));
    panel.addEventListener('click', (e) => {
        if (e.target === panel) panel.classList.remove('is-visible');
    });

    panel.querySelector('.lore-prev').addEventListener('click', () => {
        const next = (cursor - 1 + ids.length) % ids.length;
        _audio?.play?.('tick');
        _renderPage(panel, next, ids);
    });
    panel.querySelector('.lore-next').addEventListener('click', () => {
        const next = (cursor + 1) % ids.length;
        _audio?.play?.('tick');
        _renderPage(panel, next, ids);
    });
    if (!isActive) {
        panel.querySelector('.lore-try-btn').addEventListener('click', () => {
            try { setActiveSkinId(id); } catch { /* ignore */ }
            const sel = document.getElementById('skin-select');
            if (sel) sel.value = id;
            _audio?.play?.('unlock');
            panel.classList.remove('is-visible');
        });
    }
}

export const __test_only__ = { LORE };
