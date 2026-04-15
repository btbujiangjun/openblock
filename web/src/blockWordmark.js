/**
 * 「Open ★ Block」品牌字标：字母为 5×n 像素格；词间为高窄四芒星（SVG + 呼吸动画）；
 * 大写 O 角上 🎮；整词从左到右 HSL 彩虹过渡（像素列映射色相）。
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

/** 词间星形在彩虹上的「列宽」近似，用于色相衔接 Open → Block */
const WORDMARK_STAR_COL_UNITS = 2.4;

/**
 * @param {string[]} lines
 * @param {'cool' | 'warm'} side
 * @param {{ accent?: boolean; peekCorner?: 'tl' | 'tr' | 'bl' | 'br'; peekEmoji?: string; colBase?: number; totalSpan?: number }} [opts]
 */
function letterEl(lines, side, opts = {}) {
    const h = lines.length;
    const w = Math.max(...lines.map((r) => r.length), 1);
    const wrap = document.createElement('div');
    wrap.className = 'wm-letter' + (opts.accent ? ' wm-letter--accent' : '');
    if (opts.peekCorner) {
        wrap.classList.add('wm-letter--peek-emoji');
    }
    const bump = opts.accent ? 1.24 : 1;
    wrap.style.setProperty('--wm-letter-bump', String(bump));
    const cs = `calc(var(--wm-cell) * var(--wm-letter-bump))`;
    wrap.style.gridTemplateColumns = `repeat(${w}, ${cs})`;
    wrap.style.gridTemplateRows = `repeat(${h}, ${cs})`;
    const rainbow = typeof opts.totalSpan === 'number' && opts.totalSpan > 0;
    const colBase = opts.colBase ?? 0;
    const totalSpan = opts.totalSpan ?? 1;
    for (let r = 0; r < h; r++) {
        const row = lines[r].padEnd(w, '0');
        for (let c = 0; c < w; c++) {
            const ch = row[c];
            const filled = ch === '1' || ch === '#';
            const cell = document.createElement('span');
            if (filled) {
                if (rainbow) {
                    const t = (colBase + c) / totalSpan;
                    const hue = ((t * 360) % 360 + 360) % 360;
                    cell.className = 'wm-cell wm-cell--rainbow';
                    cell.style.setProperty('--wm-rainbow-hue', String(hue));
                } else {
                    cell.className = `wm-cell wm-cell--${side}`;
                }
            } else {
                cell.className = 'wm-cell wm-cell--void';
            }
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
        g.appendChild(
            letterEl(lookupBitmap(char), side, {
                accent,
                peekCorner,
                peekEmoji,
                colBase: colRun,
                totalSpan: rainbow.totalSpan,
            })
        );
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
    for (const [off, h] of [['0%', h0], ['100%', h1]]) {
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
    star.setAttribute('d',
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
        wordGroup(b, 'warm', { colOffset: wA + WORDMARK_STAR_COL_UNITS, totalSpan })
    );
    h1.appendChild(root);
}

export function mountBlockWordmarks() {
    document.querySelectorAll('h1.app-wordmark').forEach(mountInto);
}
