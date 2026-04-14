/**
 * 「Open ★ Block」品牌字标：字母为 5×n 像素格；词间为高窄四芒星（SVG + 呼吸动画）；
 * 大写 O 角上 🎮（两处 h1 同步挂载，风格统一、大小可异）。
 */

/** @type {Record<string, string[]>} 每行用 0/1，高 5 行 */
const LETTERS = {
    /* 7 列：内孔收窄为单列，环形更「实」、更厚重 */
    O: ['0111110', '1110111', '1110111', '1110111', '0111110'],
    /* Block 内小写 o 略收，避免抢 B 的视觉 */
    o: ['01110', '10001', '10001', '10001', '01110'],
    p: ['11110', '10001', '11110', '10000', '10000'],
    e: ['01110', '10001', '11111', '10000', '01110'],
    n: ['10001', '11001', '10101', '10011', '10001'],
    /* 7 列：竖画加宽（110），拱肩更满，与 O 同宽节奏 */
    B: ['1111110', '1100111', '1111110', '1100111', '1111110'],
    l: ['01000', '01000', '01000', '01000', '01110'],
    c: ['01110', '10001', '10000', '10001', '01110'],
    k: ['10001', '10010', '11100', '10010', '10001']
};

/**
 * @param {string[]} lines
 * @param {'cool' | 'warm' | 'mid'} side
 * @param {{ accent?: boolean; peekCorner?: 'tl' | 'tr' | 'bl' | 'br'; peekEmoji?: string }} [opts]
 */
function letterEl(lines, side, opts = {}) {
    const h = lines.length;
    const w = Math.max(...lines.map((r) => r.length), 1);
    const wrap = document.createElement('div');
    wrap.className = 'wm-letter' + (opts.accent ? ' wm-letter--accent' : '');
    if (opts.peekCorner) {
        wrap.classList.add('wm-letter--peek-emoji');
    }
    /* 大写 O/B 用更大网格轨道代替 transform:scale，避免与相邻字母布局重叠粘连 */
    const bump = opts.accent ? 1.24 : 1;
    wrap.style.setProperty('--wm-letter-bump', String(bump));
    const cs = `calc(var(--wm-cell) * var(--wm-letter-bump))`;
    wrap.style.gridTemplateColumns = `repeat(${w}, ${cs})`;
    wrap.style.gridTemplateRows = `repeat(${h}, ${cs})`;
    for (let r = 0; r < h; r++) {
        const row = lines[r].padEnd(w, '0');
        for (let c = 0; c < w; c++) {
            const ch = row[c];
            const filled = ch === '1' || ch === '#';
            const cell = document.createElement('span');
            cell.className = filled ? `wm-cell wm-cell--${side}` : 'wm-cell wm-cell--void';
            cell.setAttribute('aria-hidden', 'true');
            wrap.appendChild(cell);
        }
    }
    if (opts.peekCorner) {
        const peek = document.createElement('span');
        peek.className = `wm-letter__peek wm-letter__peek--${opts.peekCorner}`;
        peek.setAttribute('aria-hidden', 'true');
        peek.textContent = opts.peekEmoji || '✨';
        wrap.appendChild(peek);
    }
    return wrap;
}

function lookupBitmap(char) {
    if (LETTERS[char]) {
        return LETTERS[char];
    }
    const low = char.toLowerCase();
    if (LETTERS[low]) {
        return LETTERS[low];
    }
    const up = char.toUpperCase();
    if (LETTERS[up]) {
        return LETTERS[up];
    }
    return ['00000', '00100', '00100', '00100', '00000'];
}

/**
 * @param {string} word
 * @param {'cool' | 'warm'} side
 */
function wordGroup(word, side) {
    const g = document.createElement('div');
    g.className = 'app-wordmark-pixel__word';
    g.dataset.side = side;
    for (const char of word) {
        if (char === ' ') {
            continue;
        }
        const accent =
            (side === 'cool' && char === 'O') || (side === 'warm' && char === 'B');
        const peekCorner =
            side === 'cool' && char === 'O' ? 'tr' : undefined;
        const peekEmoji =
            side === 'cool' && char === 'O' ? '🎮' : undefined;
        g.appendChild(letterEl(lookupBitmap(char), side, { accent, peekCorner, peekEmoji }));
    }
    return g;
}

/** 词间分隔：高窄四芒星 + 中心辉光（viewBox 24×48），两处字标共用同一 DOM 工厂 */
function createCrossStarEl() {
    const wrap = document.createElement('span');
    wrap.className = 'app-wordmark-pixel__crossstar';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'app-wordmark-pixel__crossstar-svg');
    svg.setAttribute('viewBox', '0 0 24 48');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
    grad.setAttribute('id', 'starGlow');
    for (const [off, color] of [['0%', '#fff8e1'], ['45%', '#facc15'], ['100%', 'rgba(250,204,21,0)']]) {
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s.setAttribute('offset', off);
        s.setAttribute('stop-color', color);
        grad.appendChild(s);
    }
    defs.appendChild(grad);
    svg.appendChild(defs);

    const glow = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    glow.setAttribute('cx', '12');
    glow.setAttribute('cy', '24');
    glow.setAttribute('rx', '8');
    glow.setAttribute('ry', '16');
    glow.setAttribute('fill', 'url(#starGlow)');
    glow.setAttribute('opacity', '0.55');
    svg.appendChild(glow);

    const star = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    star.setAttribute('d',
        'M12 0.5 L13.4 21 L23 24 L13.4 27 L12 47.5 L10.6 27 L1 24 L10.6 21 Z'
    );
    star.setAttribute('fill', '#fbbf24');
    star.setAttribute('stroke', '#d97706');
    star.setAttribute('stroke-width', '0.4');
    star.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(star);

    const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    core.setAttribute('cx', '12');
    core.setAttribute('cy', '24');
    core.setAttribute('r', '2.8');
    core.setAttribute('fill', '#fff8e1');
    core.setAttribute('opacity', '0.92');
    svg.appendChild(core);

    wrap.appendChild(svg);
    return wrap;
}

/**
 * @param {HTMLElement} h1
 */
function mountInto(h1) {
    h1.replaceChildren();
    const root = document.createElement('div');
    root.className = 'app-wordmark-pixel';
    const phrase = 'Open·Block';
    const [a, b] = phrase.split('·');
    root.appendChild(wordGroup(a, 'cool'));
    const sepWrap = document.createElement('div');
    sepWrap.className = 'app-wordmark-pixel__sep';
    sepWrap.setAttribute('aria-hidden', 'true');
    sepWrap.appendChild(createCrossStarEl());
    root.appendChild(sepWrap);
    root.appendChild(wordGroup(b, 'warm'));
    h1.appendChild(root);
}

export function mountBlockWordmarks() {
    document.querySelectorAll('h1.app-wordmark').forEach(mountInto);
}
