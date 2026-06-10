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
    classic:    '二十年前那个冬夜落下的第一行代码——像素在黑暗中醒来，从此每一格彩色棱角都是不灭的回响。',
    titanium:   '冷冽的金属光泽在暗夜中凝结——每一块晶片都是航天合金的切片，坠入盘面时带着星辰的回音。',
    aurora:     '北极圈的天空被七色光带撕裂——落子的瞬间，极光随指尖流转，仿佛触到了银河冰冷的脉搏。',
    neonCity:   '城市天台上空弥漫着迷幻的电子浪潮——霓虹灯牌在雨夜中闪烁不息，每一局都是写给夜行者的诗。',
    ocean:      '三千米深处的黑暗被荧光点亮——每一次消除都是深海的呼吸。你是潜水者，也是潮汐本身。',
    sunset:     '琥珀凝固了亿万年的光——方块如暖色宝石坠入黄昏，每一次落子都折射出一缕落日熔金。',
    sakura:     '京都四月风起时，樱花如雪——盘面清空的刹那，是一片花瓣用尽了整个春天来亲吻大地。',
    koi:        '池塘里光影流动，锦鲤逆着月光而上——每一次消除，水面都荡开涟漪。中秋之夜，方寸之间有龙影闪过。',
    candy:      '糖果工厂的传送带在夜色中低吟——方块是即将诞生的彩色软糖。bonus 时刻藏着童年最甜的那一口。',
    bubbly:     '浅海的阳光穿透果冻般的水层——水獭翻身激起气泡，沙滩上的脚印被浪花抚平。清凉从指尖蔓延到心底。',
    toon:       '童年录像带里的卡通世界复活了——方块边缘是粗黑描边，落子的啪嗒声像极了漫画书里飞出的拟声词。',
    pixel8:     '8-bit 的灵魂栖息在每一格像素里——没有抗锯齿的温柔，只有方块沉重的撞击和清行时清脆的叮咚。',
    dawn:       '黎明前最深沉的那一刻，盘面如奶白色晨雾——你落下第一个方块，第一缕光刚好穿透地平线。',
    food:       '深夜厨房里锅铲的交响曲——披萨、拉面、汉堡在盘面起舞。每一块都是舌尖上的旅行，分数是胃的饱足感在哼唱。',
    music:      '音符在五线谱的银河上起舞——每落一子是清澈的断奏，连击汇成温柔的旋律，清行是整首曲子的华美终章。',
    pets:       '阳光洒满宠物店的午后——小猫在方块里伸懒腰，小狗摇着尾巴等你落子。它们不只是图标，是你最温柔的观众。',
    universe:   '银河旋臂上的一颗孤独行星——方块是恒星引力场中的浮岛。每次清行，都是一场微型的超新星绽放。',
    fantasy:    '紫色水晶秘境深处——精灵的鳞光、宝石的折影、巫师的斗篷在风中翻飞。每一格里都藏着古老的咒语。',
    fairy:      '萤火虫在玫瑰丛中编织光的图案——每一盏小灯都是未实现的愿望，在夜色里微微发亮，等人来点亮。',
    beast:      '远古丛林弥漫着潮湿的泥土味——豹的低吼、鹰的长啸、虎的凝视穿过雾气。它们是方块沉默而威严的守护者。',
    greece:     '爱琴海的波浪在落日下熔成金色——大理石廊柱的影子渐渐拉长。橄榄与葡萄酒的香气从方块里渗出，诸神在云端静静观望。',
    demon:      '血与硫磺的炼狱深处——恶魔在阴影里注视着你每一步。每一次 perfect，是地狱深处传来的一声悠长叹息。',
    jurassic:   '白垩纪的密林遮天蔽日——恐龙鳞片在月光下泛着微光。我们隔着亿年光阴，在同一片星空下落子。',
    industrial: '齿轮咬合的声音在十九世纪车间里回响——黄铜、铁锈与蒸汽交织。机械之神在齿轮背后，为你悄悄转动命运。',
    forbidden:  '紫禁城的红墙金瓦在夕照中流淌着光——每一块方块都是一片琉璃瓦，每一次消行都是一根千年梁柱的归位。',
    mahjong:    '深巷茶馆里烟雾缭绕——东风起，發字当头。每一张牌落在绿呢上，都是一段江湖故事的开始。',
    boardgame:  '天鹅绒赌桌在鎏金灯下泛着暗光——黑桃与红心交错，大王沉默压阵。转轮声远去，骰子轻轻停在命运的数字上。',
    sports:     '聚光灯下的绿茵场，汗水在空气中蒸发——每一次消除都是看台上爆发的欢呼。冠军只有一个，但传奇属于每一局。',
    outdoor:    '黎明前系紧登山靴的鞋带——帐篷里咖啡的香气混着松脂的味道。浪花在远处呼唤，雪道在晨光中静静延伸。',
    vehicles:   '城市午夜的高架路上——尾灯拉成一条条红色的河流。速度是唯一的信仰，引擎的轰鸣是方块落下的鼓点。',
    forest:     '北欧清晨的森林，薄雾在树梢间流淌——鹿群踏过蕨叶，麋鹿的角枝划破了透过叶隙倾泻而下的光束。',
    pirate:     '加勒比海在晨雾中苏醒——骷髅旗在风中猎猎作响。藏宝图的古老标记在每一次 bonus 中浮现，是沉没宝藏的回声。',
    farm:       '黄昏的农场被金色笼罩——麦浪翻涌，奶牛在树下打盹，炊烟袅袅升起。每一块方块都是大地结出的果实。',
    desert:     '正午的沙漠，驼铃在热浪中轻轻摇响——仙人掌的花在沙丘背阴处静静开放。每一块方块，都是海市蜃楼里凝固的诗。',
    summer:     '海风中融化的冰淇淋比分数流淌得更快——西瓜在沙滩上裂开清脆的响。每一排清空都是浪花拍岸，每一次连击都是海风拂过面庞。',
    /* 隐藏皮肤（Konami 解锁） */
    apple:      '乔布斯在车库里点亮的第一块屏幕——四十年来，每一次落子都是对完美的不妥协。至繁归于至简，每一格像素都是灵魂的显影。',
    og_geometry: '1984 年莫斯科冬夜诞生的电子幽灵——穿越四十年的光阴，栖息在每一个像素之中。这是它最初、也最真实的面容。',
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
