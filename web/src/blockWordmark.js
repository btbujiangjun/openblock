/**
 * 「Open · Block」品牌字标：5×n 像素格拼字，无底板/无描边外框。
 * 大写 O、B：更实的环形/双拱；小写 o 略收；分隔符收窄以利紧凑排布。
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
    k: ['10001', '10010', '11100', '10010', '10001'],
    /* 3 列窄分隔，整体更紧凑 */
    '·': ['010', '010', '111', '010', '010']
};

/**
 * @param {string[]} lines
 * @param {'cool' | 'warm' | 'mid'} side
 * @param {{ accent?: boolean }} [opts]
 */
function letterEl(lines, side, opts = {}) {
    const h = lines.length;
    const w = Math.max(...lines.map((r) => r.length), 1);
    const wrap = document.createElement('div');
    wrap.className = 'wm-letter' + (opts.accent ? ' wm-letter--accent' : '');
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
    return wrap;
}

function lookupBitmap(char) {
    if (char === '·' || char === '•') {
        return LETTERS['·'];
    }
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
        g.appendChild(letterEl(lookupBitmap(char), side, { accent }));
    }
    return g;
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
    const dot = letterEl(LETTERS['·'], 'mid');
    dot.classList.add('wm-letter--sep');
    sepWrap.appendChild(dot);
    root.appendChild(sepWrap);
    root.appendChild(wordGroup(b, 'warm'));
    h1.appendChild(root);
}

export function mountBlockWordmarks() {
    document.querySelectorAll('h1.app-wordmark').forEach(mountInto);
}
