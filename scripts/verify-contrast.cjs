/**
 * Verify WCAG contrast ratios for skin blockColors vs gridCell.
 * Usage: node scripts/verify-contrast.cjs
 */

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    return [
        parseInt(hex.substring(0, 2), 16),
        parseInt(hex.substring(2, 4), 16),
        parseInt(hex.substring(4, 6), 16),
    ];
}

function sRGBtoLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]) {
    return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

function contrastRatio(hex1, hex2) {
    const l1 = relativeLuminance(hexToRgb(hex1));
    const l2 = relativeLuminance(hexToRgb(hex2));
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

const SKINS_TO_CHECK = {
    mahjong:     { gridCell: '#2A4A38', blockColors: ['#4FC0A1', '#E09BA0', '#D4C4A0', '#A5ADBD', '#3BC19E', '#E6B263', '#89B0E1', '#B9B148'] },
    industrial:  { gridCell: '#1A140C', blockColors: ['#D49640', '#C44131', '#B86838', '#4F9080', '#B54F3F', '#B89060', '#6878A0', '#65707D'] },
    pirate:      { gridCell: '#0A1F32', blockColors: ['#DA3434', '#D8C4A0', '#317BAA', '#A0683A', '#2576CC', '#368351', '#C94082', '#C8923C'] },
    summer:      { gridCell: '#C8DCEA', blockColors: ['#B61829', '#765718', '#3C6719', '#2A5E94', '#186857', '#6C5B12', '#B61919', '#763A95'] },
    pets:        { gridCell: '#F5EDDC', blockColors: ['#9C5349', '#7D6251', '#6A6A45', '#48705D', '#546D65', '#796547', '#745F8A', '#706748'] },
    doodle:      { gridCell: '#E8EEF6', blockColors: ['#C03422', '#2369B1', '#84620D', '#2D7638', '#B1348E', '#217177', '#A84E0D', '#754FC8'] },
    nordic:      { gridCell: '#EAF0F0', blockColors: ['#5A6A7A', '#626C5A', '#706850', '#596A7D', '#5B6D5B', '#71665D', '#596B75', '#626B62'] },
    dawn:        { gridCell: '#FFF3D8', blockColors: ['#C63627', '#2E6CBA', '#8B651E', '#3D7752', '#7558C4', '#2F7677', '#C2355D', '#4B60D6'] },
    garden:      { gridCell: '#EAF0E4', blockColors: ['#9A572E', '#4A724A', '#87621E', '#3F6C88', '#845976', '#4D714D', '#B14646', '#3D7071'] },
    sports:      { gridCell: '#0F1C0A', blockColors: ['#579F58', '#4E7FD7', '#C86060', '#BE6B35', '#239DD9', '#668C38', '#926ECC', '#DC4F5C'] },
    classic:     { gridCell: '#2E3E50', blockColors: ['#7093E2', '#4FB8E8', '#52BC4B', '#FFC428', '#F5851E', '#BE76E8', '#65C4F0', '#EC6B77'] },
    forbidden:   { gridCell: '#2A0E12', blockColors: ['#D8252F', '#1B7E5C', '#2C6CD6', '#D8CCB0', '#E8B83C', '#317891', '#B8732C', '#E84068'] },
    vehicles:    { gridCell: '#161E2C', blockColors: ['#8090A0', '#3A71D8', '#E84020', '#408342', '#217AB6', '#E8C828', '#5080A8', '#8561C6'] },
    forest:      { gridCell: '#0E2010', blockColors: ['#A5682F', '#D97B3C', '#6B7BA2', '#518349', '#D4A028', '#C4497F', '#A36934', '#5392C9'] },
    zen:         { gridCell: '#F0EBE0', blockColors: ['#546C61', '#726458', '#4C6775', '#736552', '#526D60', '#736551', '#596783', '#5F6B52'] },
    toon:        { gridCell: '#3A2478', blockColors: ['#FF5570', '#FF7F11', '#FFD600', '#00C853', '#5590FF', '#DD60FF', '#D56F3C', '#00BCD4'] },
    outdoor:     { gridCell: '#101C2C', blockColors: ['#3878B8', '#42804D', '#8E6C51', '#E0B040', '#E08858', '#4FA8C8', '#2A8888', '#736BAA'] },
    apple:       { gridCell: '#1A1A20', blockColors: ['#C8C8CC', '#8E8E93', '#D4B88C', '#E8B4B8', '#607589', '#A8BCC8', '#6261E7', '#E55934'] },
};

// Also check fantasy as reference
SKINS_TO_CHECK.fantasy = { gridCell: '#1A0838', blockColors: ['#CC48FF', '#5080F0', '#18B848', '#E82020', '#E8B820', '#20B0D8', '#E020A0', '#9060E0'] };

console.log('=== WCAG Contrast Ratio Report ===\n');

let allPass = true;
for (const [skinId, skin] of Object.entries(SKINS_TO_CHECK)) {
    const ratios = skin.blockColors.map(c => contrastRatio(c, skin.gridCell));
    const minCR = Math.min(...ratios);
    const avgCR = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const pass = minCR >= 3.5 && avgCR >= 4.5;
    if (!pass) allPass = false;
    const status = pass ? 'PASS' : 'FAIL';
    console.log(`${status} ${skinId} (gridCell: ${skin.gridCell}) minCR=${minCR.toFixed(2)} avgCR=${avgCR.toFixed(2)}`);
    for (let i = 0; i < ratios.length; i++) {
        const flag = ratios[i] < 3.5 ? ' <<<' : '';
        console.log(`  色${i+1}: ${skin.blockColors[i]} CR=${ratios[i].toFixed(2)}${flag}`);
    }
    console.log();
}

console.log(allPass ? '\n✅ ALL SKINS PASS' : '\n❌ SOME SKINS FAIL');
process.exit(allPass ? 0 : 1);
