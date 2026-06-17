import { resources, SpriteFrame, Texture2D, ImageAsset, Color, Graphics } from 'cc';
import { Skin } from '../../core';

/**
 * 图片皮肤（如「水墨雅集」inkGarden）的方块整面贴图加载/缓存。
 *
 * web 主端用 `skin.blockIconAssets[colorIdx]` 把一张 PNG 满铺到方块格面（替代 Graphics 绘面 + emoji）。
 * cocos 的 Graphics 无法绘制位图，因此改用 Sprite 节点渲染：本模块负责把 8 张 PNG 解析为
 * SpriteFrame 并按 skin.id 缓存，供 BoardView / DockView / 拖拽 ghost / SkinPanel 预览复用。
 *
 * 兼容两种导入方式（无需改 .meta）：
 *   1) 已按 sprite-frame 导入 → `<path>/spriteFrame` 直接命中；
 *   2) 仅 texture（当前 inkGarden 的 png.meta 即此）→ 退化加载 `<path>/texture` 或 ImageAsset 再包成 SpriteFrame。
 */

type FrameArr = (SpriteFrame | null)[];

const _cache = new Map<string, FrameArr>();
const _loading = new Set<string>();
const _pending = new Map<string, Array<() => void>>();

/** 该皮肤是否使用「整面贴图」渲染（命中后跳过 Graphics 绘面 + emoji）。 */
export function skinHasImageBlocks(skin: Skin): boolean {
    return !!(skin.blockIconAssets && skin.blockIconAssets.length);
}

/** 取该皮肤的 blockBevel 配置（用于图片皮肤的柔光浮雕叠加）。 */
function bevelOf(skin: Skin): { assetOverlay: boolean; overlayTop: number; overlayBottom: number; innerStroke: string; outerStroke: string } {
    const b = (skin as unknown as { blockBevel?: Record<string, unknown> }).blockBevel ?? {};
    return {
        assetOverlay: (b.assetOverlay as boolean) ?? false,
        overlayTop: (b.overlayTop as number) ?? 0.10,
        overlayBottom: (b.overlayBottom as number) ?? 0.05,
        innerStroke: (b.innerStroke as string) ?? 'rgba(255,255,255,0.42)',
        outerStroke: (b.outerStroke as string) ?? 'rgba(82,68,52,0.26)',
    };
}

/** 该皮肤是否配置了「图片皮肤的柔光浮雕叠加」（blockBevel.assetOverlay）。 */
export function skinHasAssetOverlay(skin: Skin): boolean {
    if (!skinHasImageBlocks(skin)) return false;
    return bevelOf(skin).assetOverlay === true;
}

/** 复用解析缓存：'rgba(r,g,b,a)' / '#rrggbb' → Color，避免逐格重新 parseFloat。 */
const _strokeCache = new Map<string, Color>();
function parseStroke(s: string, fallback: [number, number, number, number]): Color {
    let c = _strokeCache.get(s);
    if (c) return c;
    const t = (s || '').trim();
    let r = fallback[0], g = fallback[1], b = fallback[2], a = fallback[3];
    if (t.startsWith('rgb')) {
        const nums = t.replace(/rgba?\(|\)/g, '').split(',').map((p) => parseFloat(p.trim()));
        r = nums[0] || 0; g = nums[1] || 0; b = nums[2] || 0;
        a = nums[3] === undefined ? 255 : Math.round(nums[3] * 255);
    } else if (t.startsWith('#')) {
        let h = t.slice(1);
        if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
        r = parseInt(h.substring(0, 2), 16) || 0;
        g = parseInt(h.substring(2, 4), 16) || 0;
        b = parseInt(h.substring(4, 6), 16) || 0;
        a = 255;
    }
    c = new Color(r, g, b, a);
    _strokeCache.set(s, c);
    return c;
}

/**
 * 复用 scratch Color：64 格盘面 × 多次 fill/stroke 累计调用上百次，
 * 用单一 scratch 避免逐次 new Color 的 GC 压力（Graphics 内部会 _color.set() 拷贝，安全）。
 */
const _ovTmp = new Color(255, 255, 255, 255);

/**
 * 图片皮肤「柔光浮雕」叠加（对齐 web `_paintAssetSoftOverlay` + outer/innerStroke）：
 *   - 顶部 ~28% 高度叠 alpha=overlayTop 的白色渐变（cocos Graphics 无渐变，用 4 段衰减白带近似）；
 *   - 底部 ~20% 高度叠 alpha=overlayBottom 的黑色渐变（同上，3 段衰减黑带）；
 *   - 外圈 outerStroke 描边（默认 rgba(82,68,52,0.26)，浅盘暖棕轮廓）；
 *   - 内圈 innerStroke 描边（默认 rgba(255,255,255,0.42)，内侧白光高光）。
 *
 * 调用方提供一个浮在 sprite 之上的 Graphics 节点，逐格在每个 sprite 位置上叠这一层。
 * 帧成本：每格 7 次 fill + 2 次 stroke ≈ 9 Graphics 调用；64 格全盘 ~580 次，与 paintBlockFace
 * 同量级，且只在图片皮肤路径调，不影响其他皮肤。所有 Color 复用 scratch，零 alloc。
 *
 * @param g       叠加层 Graphics（调用前已 clear）
 * @param skin    图片皮肤（需 blockBevel.assetOverlay=true）
 * @param x,y     格面左下角（与 sprite 同坐标基准；sprite 中心 = (x+size/2, y+size/2)）
 * @param size    格面边长（与 sprite contentSize 一致）
 * @param r       圆角半径（与 skin.blockRadius 对齐，0 = 直角）
 * @param alpha   半透明（拖拽 ghost = 140，正常 = 255）；按 alpha/255 衰减叠加层 alpha
 */
export function paintAssetOverlay(g: Graphics, skin: Skin, x: number, y: number, size: number, r: number, alpha = 255): void {
    if (!skinHasAssetOverlay(skin)) return;
    if (size <= 0) return;
    const bev = bevelOf(skin);
    const aMul = alpha / 255;

    // ── 1) 顶部白色高光：4 段衰减白带（顶最亮→透明，覆盖 0~28% 高度）
    const topH = size * 0.28;
    const topA = Math.round(255 * bev.overlayTop * aMul);
    if (topA > 0 && topH >= 1) {
        const bands = 4;
        const bandH = topH / bands;
        for (let i = 0; i < bands; i++) {
            const a = Math.round(topA * (1 - i / bands));
            if (a <= 0) continue;
            _ovTmp.set(255, 255, 255, a);
            g.fillColor = _ovTmp;
            const by = y + size - topH + (bands - 1 - i) * bandH;
            if (r > 0) g.roundRect(x, by, size, bandH, Math.max(0, r - i));
            else g.rect(x, by, size, bandH);
            g.fill();
        }
    }

    // ── 2) 底部黑色暗角：3 段衰减黑带（覆盖底部 20%）
    const botH = size * 0.20;
    const botA = Math.round(255 * bev.overlayBottom * aMul);
    if (botA > 0 && botH >= 1) {
        const bands = 3;
        const bandH = botH / bands;
        for (let i = 0; i < bands; i++) {
            const a = Math.round(botA * ((i + 1) / bands));
            if (a <= 0) continue;
            _ovTmp.set(0, 0, 0, a);
            g.fillColor = _ovTmp;
            const by = y + i * bandH;
            if (r > 0) g.roundRect(x, by, size, bandH, Math.max(0, r - (bands - 1 - i)));
            else g.rect(x, by, size, bandH);
            g.fill();
        }
    }

    // ── 3) 外圈描边（暖棕轮廓，加强方块边界感）
    const outer = parseStroke(bev.outerStroke, [82, 68, 52, Math.round(0.26 * 255)]);
    if (outer.a > 0 && size > 2) {
        g.lineWidth = 1.25;
        _ovTmp.set(outer.r, outer.g, outer.b, Math.round(outer.a * aMul));
        g.strokeColor = _ovTmp;
        if (r > 0) g.roundRect(x + 0.5, y + 0.5, size - 1, size - 1, Math.max(0, r - 0.5));
        else g.rect(x + 0.5, y + 0.5, size - 1, size - 1);
        g.stroke();
    }

    // ── 4) 内圈描边（白光高光，浮雕"凸"感的核心）
    const inner = parseStroke(bev.innerStroke, [255, 255, 255, Math.round(0.42 * 255)]);
    if (inner.a > 0 && size > 3) {
        g.lineWidth = 1;
        _ovTmp.set(inner.r, inner.g, inner.b, Math.round(inner.a * aMul));
        g.strokeColor = _ovTmp;
        if (r > 0) g.roundRect(x + 1.5, y + 1.5, size - 3, size - 3, Math.max(0, r - 1.5));
        else g.rect(x + 1.5, y + 1.5, size - 3, size - 3);
        g.stroke();
    }
}

/**
 * 该皮肤的方块贴图是否已全部加载入缓存。
 * 用于让调用方在「已就绪」时跳过 onReady 重绘回调注册 —— 否则若回调本身又触发一次绘制，
 * 而 ensureSkinBlockFrames 命中缓存会**同步**回调，便形成无限递归（drawGhost↔onReady）。
 */
export function skinBlockFramesReady(skin: Skin): boolean {
    return _cache.has(skin.id);
}

/** 取已缓存的某色方块贴图；未加载完成返回 null（调用方此时回退绘面占位）。 */
export function getSkinBlockFrame(skin: Skin, colorIdx: number): SpriteFrame | null {
    const arr = _cache.get(skin.id);
    if (!arr || !arr.length) return null;
    const n = arr.length;
    const f = arr[((colorIdx % n) + n) % n];
    return f || null;
}

/**
 * 确保该皮肤的全部方块贴图开始/完成加载。
 * - 已缓存：立即回调 onReady（包 try，回调里的异常不影响调用方）；
 * - 加载中：onReady 入队，待整批完成统一回调（供各视图加载完后重绘一次）。
 *
 * 严格异常隔离：任何 onReady 回调（render() / 视图刷新）抛错都被吞掉，
 * 避免一处皮肤资源加载完成时的副作用把整个 setSkin 链路打断造成白屏。
 */
export function ensureSkinBlockFrames(skin: Skin, onReady?: () => void): void {
    if (!skinHasImageBlocks(skin)) return;
    if (_cache.has(skin.id)) { try { onReady?.(); } catch { /* ignore */ } return; }
    if (onReady) {
        const list = _pending.get(skin.id) ?? [];
        list.push(onReady);
        _pending.set(skin.id, list);
    }
    if (_loading.has(skin.id)) return;
    _loading.add(skin.id);

    const paths = skin.blockIconAssets!;
    const frames: FrameArr = new Array(paths.length).fill(null);
    let remaining = paths.length;
    const finish = (): void => {
        _cache.set(skin.id, frames);
        _loading.delete(skin.id);
        const cbs = _pending.get(skin.id);
        _pending.delete(skin.id);
        cbs?.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
    };
    paths.forEach((p, i) => {
        loadOneFrame(p, (sf) => {
            frames[i] = sf;
            if (--remaining === 0) finish();
        });
    });
}

/**
 * 单张加载：sprite-frame → ImageAsset → texture 三级兜底，全失败回 null。
 *
 * 顺序很重要（inkGarden 白屏的根因就在这里）：
 *   1) sprite-frame：若 .meta 已 sprite-frame 导入 → 直接拿到 SpriteFrame，最优；
 *   2) ImageAsset：当前 inkGarden 的 png.meta 只产 `texture` 子资源、没有 `spriteFrame`，
 *      用 ImageAsset 走原始位图入口（`resources.load(path, ImageAsset)` 命中根资源即可），
 *      再 `SpriteFrame.createWithImage(img)` 包装 —— 这是 cocos 3.8 官方支持的标准路径；
 *   3) Texture2D：极端兜底（路径写错时基本也命不中）。注意 `createWithImage(tex)` 在
 *      3.8 上对 Texture2D 的支持不稳，**不能**作为主路径，否则会出现拿到 SpriteFrame
 *      但 rect/未初始化 → Sprite 渲染空白 → 视觉上"切到该皮肤整盘白屏"。
 *
 * 全过程异常都被本函数吞掉，绝不把同步异常冒泡到 setSkin → applySkinImmediate 链上，
 * 否则任何一步失败都会让切肤回调中断、整帧渲染流程跑不完 → 表现为白屏。
 */
function loadOneFrame(path: string, cb: (sf: SpriteFrame | null) => void): void {
    const safeCb = (sf: SpriteFrame | null): void => { try { cb(sf); } catch { /* ignore */ } };
    try {
        resources.load(`${path}/spriteFrame`, SpriteFrame, (err: unknown, sf: SpriteFrame) => {
            if (!err && sf) {
                // 即使是已导入的 SpriteFrame，也补一次 mipmap+trilinear
                // —— 否则 dock 26px / mini 预览 ≈18px 等小尺寸渲染仍会 256→26 双线性糊化。
                try { if (sf.texture) enableMipmap(sf.texture); } catch { /* ignore */ }
                safeCb(sf); return;
            }
            try {
                resources.load(path, ImageAsset, (e2: unknown, img: ImageAsset) => {
                    if (!e2 && img) { safeCb(wrapImage(img)); return; }
                    try {
                        resources.load(`${path}/texture`, Texture2D, (e3: unknown, tex: Texture2D) => {
                            if (!e3 && tex) { safeCb(wrapTexture(tex)); return; }
                            console.warn('[OpenBlock] skin block asset load failed:', path);
                            safeCb(null);
                        });
                    } catch (err3) {
                        console.warn('[OpenBlock] resources.load texture threw:', path, err3);
                        safeCb(null);
                    }
                });
            } catch (err2) {
                console.warn('[OpenBlock] resources.load ImageAsset threw:', path, err2);
                safeCb(null);
            }
        });
    } catch (err1) {
        console.warn('[OpenBlock] resources.load SpriteFrame threw:', path, err1);
        safeCb(null);
    }
}

/**
 * 给 SpriteFrame 关联的纹理开启 mipmap + 三线性过滤 —— 解决"高分辨率 PNG 缩到很小尺寸糊成一团":
 *
 *   inkGarden block-*.png 原图 256×256，dock cell ≈ 26px → 缩放约 10×。
 *   Cocos 默认 LINEAR + 无 mipmap → 单层双线性插值在 ≥4× 降采样时会丢失高频细节，
 *   表现为线条糊化、色块互相渗透（用户截图所见）。
 *
 *   开启 mipmap 后 GPU 在采样时按 1/2 系列预生成的级联自动挑最接近目标尺寸的层，
 *   高频细节按层下采样保留，缩到 dock 大小依然锐利。代价：纹理内存 +33%（8 张 256² RGBA
 *   ≈ 2MB → 2.67MB，可忽略）。trilinear (mip linear) 让 mip 层之间也线性过渡，
 *   在板块缩放动画（spawn/flip）时没有可见的层切跳变。
 *
 *   iOS 低端机（iPhone 11 Apple A13）GPU 完全支持，反而比 LINEAR 多次采样更省 fragment 工作量。
 *
 *   API 兼容：cocos 3.8 Texture2D 暴露 `mipmapLevel` setter（>0 触发 GPU mipmap 链生成）
 *   和 `setFilters(Filter.LINEAR, Filter.LINEAR)` + `setMipFilter(Filter.LINEAR)`。
 *   为避免类型耦合 cc 内部 enum，这里走 any-cast 调用，运行时按枚举值 2/3 兜底。
 */
function enableMipmap(tex: unknown): void {
    if (!tex) return;
    try {
        // Filter.LINEAR = 2（cc 3.8 GFX const），mipFilter LINEAR 触发 trilinear。
        const t = tex as { mipmapLevel?: number; setFilters?: (min: number, mag: number) => void; setMipFilter?: (m: number) => void };
        if (typeof t.setFilters === 'function') t.setFilters(2, 2);
        if (typeof t.setMipFilter === 'function') t.setMipFilter(2);
        // 显式触发 mip 链生成（不同 cc 子版本 setter 名称略异，写多个兜底）。
        if (typeof t.mipmapLevel === 'number' || 'mipmapLevel' in (t as object)) {
            // 256×256 → log2(256)=8，留出全链以适配任意小尺寸。
            (t as { mipmapLevel: number }).mipmapLevel = 8;
        }
    } catch (err) {
        console.warn('[OpenBlock] enableMipmap failed:', err);
    }
}

/** ImageAsset → SpriteFrame：cocos 3.8 的正统入口（createWithImage 对 ImageAsset 形参稳定支持）。 */
function wrapImage(img: ImageAsset): SpriteFrame | null {
    try {
        const sf = SpriteFrame.createWithImage(img);
        if (sf) enableMipmap(sf.texture);
        return sf || null;
    } catch (err) {
        console.warn('[OpenBlock] createWithImage(ImageAsset) failed:', err);
        return null;
    }
}

/**
 * Texture2D → SpriteFrame：兜底路径。
 * 不走 `createWithImage(tex)`（3.8 对 Texture2D 形参不稳），改为 new SpriteFrame() 后
 * `texture = tex`（标准 setter，内部会按 texture 尺寸建立合法 rect），保证渲染可见。
 */
function wrapTexture(tex: Texture2D): SpriteFrame | null {
    try {
        const sf: SpriteFrame = new SpriteFrame();
        sf.texture = tex;
        enableMipmap(tex);
        return sf;
    } catch (err) {
        console.warn('[OpenBlock] new SpriteFrame + texture failed:', err);
        return null;
    }
}
