/**
 * 「Open ★ Block」品牌字标：7 行像素格；CSS 用窄格宽 + 高格深营造修长比例。
 * 极简版本：仅保留极少量游戏 icon 点缀，优先保证字形可读性与整体节奏感。
 */
const LETTERS = {
    /* 6 列：环略收，更修长 */
    O: [
        '011110',
        '110011',
        '110011',
        '110011',
        '110011',
        '110011',
        '011110',
    ],
    p: [
        '11110',
        '10011',
        '10011',
        '11110',
        '10000',
        '10000',
        '10000',
    ],
    /* 4 列经典 E：右上封口（第二行末位为 1），并与 n 拉开字距 */
    e: [
        '1111',
        '1001',
        '1001',
        '1111',
        '1000',
        '1000',
        '1111',
    ],
    /*
     * 小写 n：6 列单像素阶梯对角（每行向右错一格），斜线连贯；
     * 比 5 列粗折线更易读、更接近 45° 视觉。
     */
    n: [
        '100001',
        '110001',
        '101001',
        '100101',
        '100011',
        '100001',
        '100001',
    ],
    /* 6 列双腔 B */
    B: [
        '111110',
        '110011',
        '110011',
        '111110',
        '110011',
        '110011',
        '111110',
    ],
    l: [
        '01000',
        '01000',
        '01000',
        '01000',
        '01000',
        '01000',
        '01111',
    ],
    o: [
        '01110',
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '01110',
    ],
    c: [
        '01110',
        '10001',
        '10000',
        '10000',
        '10000',
        '10001',
        '01110',
    ],
    /* K 回归普通清晰字形（不做强化） */
    k: [
        '10001',
        '10010',
        '10100',
        '11000',
        '10100',
        '10010',
        '10001',
    ],
};

/**
 * 游戏 icon 映射：某些字母的特定格子用 emoji 替换实心方块。
 * key = 字母, value = [{ r, c, emoji }]
 * 坐标基于 7 行 LETTERS 网格。
 */
const ICON_MAP = {
    // 极简点缀：每个单词保留 1 个 icon
    /* 与 B 一致：顶行左上实心格（O 首行 011110，左上为 c=1） */
    O: [{ r: 0, c: 1, emoji: '🎮' }],
    B: [{ r: 0, c: 0, emoji: '⭐' }],
};

function lookupBitmap(char) {
    if (LETTERS[char]) return LETTERS[char];
    const low = char.toLowerCase();
    if (LETTERS[low]) return LETTERS[low];
    const up = char.toUpperCase();
    if (LETTERS[up]) return LETTERS[up];
    return ['0000', '0000', '0100', '0100', '0100', '0000', '0000'];
}

function letterBitmapWidth(char) {
    const lines = lookupBitmap(char);
    return Math.max(...lines.map((l) => l.length), 1);
}

function wordWidth(word) {
    let s = 0;
    for (const ch of word) {
        if (ch === ' ') continue;
        s += letterBitmapWidth(ch);
    }
    return s;
}

const WORDMARK_STAR_COL_UNITS = 2.4;

/** 当前行最左侧实心列（O/B 仅强化左缘） */
function leftmostFilledCol(rowStr) {
    for (let i = 0; i < rowStr.length; i++) {
        const ch = rowStr[i];
        if (ch === '1' || ch === '#' || ch === '2') return i;
    }
    return -1;
}

/**
 * @param {string[]} lines
 * @param {'cool' | 'warm'} side
 * @param {{ accent?: boolean; icons?: {r:number,c:number,emoji:string}[]; colBase?: number; totalSpan?: number }} [opts]
 */
function letterEl(lines, side, opts = {}) {
    const h = lines.length;
    const w = Math.max(...lines.map((r) => r.length), 1);
    const wrap = document.createElement('div');
    wrap.className = 'wm-letter' + (opts.accent ? ' wm-letter--accent' : '');
    if (opts.char) {
        wrap.dataset.char = opts.char;
    }
    /* O/B：不再整字等比放大，仅上边 + 左边像素格加笔触（见 .wm-cell--accent-*） */
    const bump = 1;
    wrap.style.setProperty('--wm-letter-bump', String(bump));
    const cw = `calc(var(--wm-cell-w) * var(--wm-letter-bump))`;
    const ch_ = `calc(var(--wm-cell-h) * var(--wm-letter-bump))`;
    wrap.style.gridTemplateColumns = `repeat(${w}, ${cw})`;
    wrap.style.gridTemplateRows = `repeat(${h}, ${ch_})`;

    const rainbow = typeof opts.totalSpan === 'number' && opts.totalSpan > 0;
    const colBase = opts.colBase ?? 0;
    const totalSpan = opts.totalSpan ?? 1;
    const icons = opts.icons || [];
    const iconLookup = {};
    for (const ic of icons) iconLookup[`${ic.r},${ic.c}`] = ic.emoji;

    for (let r = 0; r < h; r++) {
        const row = lines[r].padEnd(w, '0');
        const leftCol = leftmostFilledCol(row);
        for (let c = 0; c < w; c++) {
            const filled = row[c] === '1' || row[c] === '#' || row[c] === '2';
            const iconEmoji = iconLookup[`${r},${c}`];
            const cell = document.createElement('span');
            const accentTop = Boolean(opts.accent && filled && r === 0);
            const accentLeft = Boolean(opts.accent && filled && c === leftCol && leftCol >= 0);
            const edgeClasses =
                accentTop || accentLeft
                    ? ` wm-cell--accent-edge${accentTop ? ' wm-cell--accent-top' : ''}${accentLeft ? ' wm-cell--accent-left' : ''}`
                    : '';
            if (filled && iconEmoji) {
                cell.className = 'wm-cell wm-cell--icon' + edgeClasses;
                cell.textContent = iconEmoji;
                if (rainbow) {
                    const t = (colBase + c) / totalSpan;
                    const hue = ((t * 360) % 360 + 360) % 360;
                    cell.style.setProperty('--wm-rainbow-hue', String(hue));
                    cell.classList.add('wm-cell--rainbow-icon');
                }
            } else if (filled) {
                if (rainbow) {
                    const t = (colBase + c) / totalSpan;
                    const hue = ((t * 360) % 360 + 360) % 360;
                    cell.className = 'wm-cell wm-cell--rainbow' + edgeClasses;
                    cell.style.setProperty('--wm-rainbow-hue', String(hue));
                } else {
                    cell.className = `wm-cell wm-cell--${side}` + edgeClasses;
                }
            } else {
                cell.className = 'wm-cell wm-cell--void';
            }
            cell.setAttribute('aria-hidden', 'true');
            wrap.appendChild(cell);
        }
    }
    return wrap;
}

/**
 * @param {string} word
 * @param {'cool' | 'warm'} side
 * @param {{ colOffset: number; totalSpan: number }} rainbow
 */
function wordGroup(word, side, rainbow) {
    const g = document.createElement('div');
    g.className = 'app-wordmark-pixel__word';
    g.dataset.side = side;
    let colRun = rainbow.colOffset;
    let prevChar = '';
    for (const char of word) {
        if (char === ' ') continue;
        const accent =
            (side === 'cool' && char === 'O') || (side === 'warm' && char === 'B');
        const icons = ICON_MAP[char] || [];
        const letter = letterEl(lookupBitmap(char), side, {
            accent,
            icons,
            char,
            colBase: colRun,
            totalSpan: rainbow.totalSpan,
        });
        // Open 中 e 与 n 拉开，避免窄体下粘连
        if (prevChar === 'e' && char === 'n' && side === 'cool') {
            letter.style.marginInlineStart = '0.2em';
        }
        g.appendChild(letter);
        prevChar = char;
        colRun += letterBitmapWidth(char);
    }
    return g;
}

/**
 * @param {{ hueMid?: number; gradId?: string }} [opts]
 */
function createCrossStarEl(opts = {}) {
    const hueMid = typeof opts.hueMid === 'number' ? opts.hueMid : 48;
    const gid = opts.gradId || `wm-star-${Math.random().toString(36).slice(2, 9)}`;

    const wrap = document.createElement('span');
    wrap.className = 'app-wordmark-pixel__crossstar';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'app-wordmark-pixel__crossstar-svg');
    svg.setAttribute('viewBox', '0 0 24 48');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradRadial = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
    gradRadial.setAttribute('id', `${gid}-glow`);
    gradRadial.setAttribute('cx', '50%');
    gradRadial.setAttribute('cy', '50%');
    gradRadial.setAttribute('r', '65%');
    for (const [off, color] of [
        ['0%', `hsl(${hueMid}, 95%, 96%)`],
        ['42%', `hsl(${hueMid}, 88%, 72%)`],
        ['100%', `hsla(${hueMid}, 80%, 55%, 0)`],
    ]) {
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s.setAttribute('offset', off);
        s.setAttribute('stop-color', color);
        gradRadial.appendChild(s);
    }
    defs.appendChild(gradRadial);

    const gradLin = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradLin.setAttribute('id', `${gid}-star`);
    gradLin.setAttribute('x1', '0%');
    gradLin.setAttribute('y1', '0%');
    gradLin.setAttribute('x2', '100%');
    gradLin.setAttribute('y2', '100%');
    const h0 = (hueMid - 28 + 360) % 360;
    const h1 = (hueMid + 28) % 360;
    for (const [off, h] of [
        ['0%', h0],
        ['100%', h1],
    ]) {
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s.setAttribute('offset', off);
        s.setAttribute('stop-color', `hsl(${h}, 92%, 58%)`);
        gradLin.appendChild(s);
    }
    defs.appendChild(gradLin);
    svg.appendChild(defs);

    const glow = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    glow.setAttribute('cx', '12');
    glow.setAttribute('cy', '24');
    glow.setAttribute('rx', '8');
    glow.setAttribute('ry', '16');
    glow.setAttribute('fill', `url(#${gid}-glow)`);
    glow.setAttribute('opacity', '0.55');
    svg.appendChild(glow);

    const star = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    star.setAttribute(
        'd',
        'M12 0.5 L13.4 21 L23 24 L13.4 27 L12 47.5 L10.6 27 L1 24 L10.6 21 Z'
    );
    star.setAttribute('fill', `url(#${gid}-star)`);
    star.setAttribute('stroke', `hsl(${hueMid}, 75%, 38%)`);
    star.setAttribute('stroke-width', '0.4');
    star.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(star);

    const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    core.setAttribute('cx', '12');
    core.setAttribute('cy', '24');
    core.setAttribute('r', '2.8');
    core.setAttribute('fill', `hsl(${hueMid}, 40%, 96%)`);
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
    root.className = 'app-wordmark-pixel app-wordmark-pixel--rainbow';
    const phrase = 'Open·Block';
    const [a, b] = phrase.split('·');
    const wA = wordWidth(a);
    const wB = wordWidth(b);
    const totalSpan = wA + WORDMARK_STAR_COL_UNITS + wB;
    const gradId = `wm-${Math.random().toString(36).slice(2, 10)}`;
    const hueStar = ((wA + WORDMARK_STAR_COL_UNITS / 2) / totalSpan) * 360;

    root.appendChild(wordGroup(a, 'cool', { colOffset: 0, totalSpan }));
    const sepWrap = document.createElement('div');
    sepWrap.className = 'app-wordmark-pixel__sep';
    sepWrap.setAttribute('aria-hidden', 'true');
    sepWrap.appendChild(createCrossStarEl({ hueMid: hueStar, gradId }));
    root.appendChild(sepWrap);
    root.appendChild(
        wordGroup(b, 'warm', {
            colOffset: wA + WORDMARK_STAR_COL_UNITS,
            totalSpan,
        })
    );
    h1.appendChild(root);
}

export function mountBlockWordmarks() {
    document.querySelectorAll('h1.app-wordmark').forEach(mountInto);
}
